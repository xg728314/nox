/**
 * MFA backup codes — TOTP 분실 시 1회용 복구 코드.
 *
 * R25 (2026-04-25): 사장 폰 분실 = 영구 잠금 회로 차단.
 *
 * 설계:
 *   - 발급 시 8개 생성. 각 12자 (4-4-4) 영숫자 (가독 향상 위해 대시).
 *   - 평문은 발급 직후 1회만 사용자에게 보여줌 — 서버는 SHA-256 해시만 저장.
 *   - 검증은 `consumeBackupCode` 가 hashed array 에서 매칭 코드 1개를
 *     **원자적으로 제거** (남은 codes 만 다시 저장). race 상황에서도 같은
 *     코드를 두 번 못 쓰도록 `precondition: hashed_array == old_value` 처럼
 *     동작 (Postgres 의 array equality 비교).
 *   - 비교는 `timingSafeEqual` — code-by-code 동시성 회피.
 *
 * 코드 포맷 — 영문 대문자/숫자 중 헷갈리는 문자 제외 (`0/O`, `1/I/L`):
 *   `XXXX-XXXX-XXXX` (4자 그룹 3개 = 12자, 31^12 ≈ 7.8e17 entropy)
 *
 * 검증 시 입력 정규화: 공백/소문자 제거 → 대문자 + 대시 4자 단위 재포맷.
 */

import crypto from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

// 0, O, 1, I, L 제외. 31자 알파벳.
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const GROUP_LEN = 4
const GROUPS = 3
const CODE_PLAIN_LEN = GROUP_LEN * GROUPS // 12 chars net
const DEFAULT_CODE_COUNT = 8

/**
 * 평문 코드 8개 + 해시 8개 동시 생성.
 *   - plain: 사용자에게 1회만 보여줄 값 (`XXXX-XXXX-XXXX`)
 *   - hashed: DB 에 저장할 SHA-256 hex
 */
export function generateBackupCodes(count: number = DEFAULT_CODE_COUNT): {
  plain: string[]
  hashed: string[]
} {
  const plain: string[] = []
  const hashed: string[] = []
  for (let i = 0; i < count; i++) {
    const code = randomCode()
    plain.push(formatPlain(code))
    hashed.push(hashCode(code))
  }
  return { plain, hashed }
}

/** 12자 raw (대시 없음). */
function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_PLAIN_LEN)
  let s = ""
  for (let i = 0; i < CODE_PLAIN_LEN; i++) {
    s += ALPHA[bytes[i] % ALPHA.length]
  }
  return s
}

function formatPlain(rawCode: string): string {
  const parts: string[] = []
  for (let i = 0; i < GROUPS; i++) {
    parts.push(rawCode.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN))
  }
  return parts.join("-")
}

function hashCode(rawCode: string): string {
  return crypto.createHash("sha256").update(rawCode).digest("hex")
}

/**
 * 사용자 입력 정규화: 공백/대시 제거 + 대문자 변환.
 *   "abcd efgh-2345" → "ABCDEFGH2345"
 *   포맷이 12자가 아니면 null.
 */
export function normalizeBackupCode(input: string): string | null {
  if (typeof input !== "string") return null
  const stripped = input.replace(/[-\s]/g, "").toUpperCase()
  if (stripped.length !== CODE_PLAIN_LEN) return null
  if (!new RegExp(`^[${ALPHA}]+$`).test(stripped)) return null
  return stripped
}

/**
 * 사용자 입력처럼 보이는지 빠른 판별.
 *   TOTP (6자리 숫자) vs 백업코드 (12자 영숫자) 분기에 사용.
 */
export function looksLikeBackupCode(input: string): boolean {
  return normalizeBackupCode(input) !== null
}

/**
 * 백업 코드 검증 + 원자적 소비.
 *   - 매칭되는 코드를 hashed 배열에서 제거하고 DB 업데이트.
 *   - `WHERE backup_codes_hashed = <prev>` 로 race 회피 (다른 요청이 동시에
 *     같은 코드를 소비하면 update 가 0 row 반환 → 실패).
 *   - 성공 시 { ok: true, remaining }, 실패 시 { ok: false, reason }.
 *
 * 호출자는 ok=true 일 때만 로그인 진행.
 */
export async function consumeBackupCode(
  supabase: SupabaseClient,
  userId: string,
  inputCode: string,
): Promise<
  | { ok: true; remaining: number }
  | { ok: false; reason: "invalid_format" | "no_codes" | "not_found" | "race" | "db_error" }
> {
  const norm = normalizeBackupCode(inputCode)
  if (!norm) return { ok: false, reason: "invalid_format" }
  const candidate = hashCode(norm)

  const { data: row, error: readErr } = await supabase
    .from("user_mfa_settings")
    .select("backup_codes_hashed")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle()

  if (readErr) return { ok: false, reason: "db_error" }
  const codes: string[] = Array.isArray((row as { backup_codes_hashed?: string[] } | null)?.backup_codes_hashed)
    ? ((row as { backup_codes_hashed?: string[] }).backup_codes_hashed as string[])
    : []
  if (codes.length === 0) return { ok: false, reason: "no_codes" }

  // timing-safe match — 평균 32 hex 비교 한 번이라 비용 미미.
  let matchedIdx = -1
  for (let i = 0; i < codes.length; i++) {
    const a = Buffer.from(codes[i], "utf8")
    const b = Buffer.from(candidate, "utf8")
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      matchedIdx = i
      break
    }
  }
  if (matchedIdx === -1) return { ok: false, reason: "not_found" }

  const remaining = [...codes.slice(0, matchedIdx), ...codes.slice(matchedIdx + 1)]

  // 원자적 소비: 이전 배열 값과 정확히 일치할 때만 update.
  // 다른 요청이 동시에 같은 코드를 소비했다면 .eq("backup_codes_hashed", codes)
  // 가 0 row 매칭 → race 로 분류하고 거부.
  const { data: updated, error: updErr } = await supabase
    .from("user_mfa_settings")
    .update({
      backup_codes_hashed: remaining,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("backup_codes_hashed", codes as unknown as string)
    .select("user_id")

  if (updErr) return { ok: false, reason: "db_error" }
  if (!updated || updated.length === 0) return { ok: false, reason: "race" }
  return { ok: true, remaining: remaining.length }
}

/**
 * 새 코드 세트 발급 + 기존 코드 전체 폐기.
 *   - 호출자는 반드시 사전에 TOTP 재인증 통과시킬 것.
 *   - 결과 평문은 1회만 사용자에게 표시 후 즉시 폐기 (서버 세션에 저장 X).
 */
export async function regenerateBackupCodes(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; plain: string[] } | { ok: false; reason: "db_error" | "mfa_not_setup" }> {
  // mfa 설정이 있는지만 확인 — 발급 자체는 enable 여부와 무관 (활성 직전 setup 단계에서도 가능).
  const { data: row, error: readErr } = await supabase
    .from("user_mfa_settings")
    .select("user_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle()
  if (readErr) return { ok: false, reason: "db_error" }
  if (!row) return { ok: false, reason: "mfa_not_setup" }

  const { plain, hashed } = generateBackupCodes()
  const { error: updErr } = await supabase
    .from("user_mfa_settings")
    .update({
      backup_codes_hashed: hashed,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)

  if (updErr) return { ok: false, reason: "db_error" }
  return { ok: true, plain }
}
