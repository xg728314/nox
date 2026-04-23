import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { computeAttendanceAnomalies } from "@/lib/server/queries/opsAttendanceAnomalies"
import { emitAutomationAlert } from "@/lib/automation/alertHooks"

/**
 * GET /api/cron/ops-alerts-scan
 *
 * ROUND-ALERT-1 — ops anomaly 자동 스캔 + Telegram 발송.
 *
 * 처리 범위 (1차):
 *   - duplicate_open  (≥1)
 *   - tag_mismatch    (≥3)  ← 노이즈 완화 위해 누적 임계치
 *   - no_business_day (≥1)
 *
 * 그 외 (recent_checkout_block) 는 1차 범위 외.
 *
 * 보안:
 *   - Authorization: Bearer <CRON_SECRET> (timingSafeEqual)
 *   - user-agent: vercel-cron/*
 *   그 외 401.
 *
 * 순회 대상:
 *   `stores.where(is_active=true, deleted_at IS NULL)` 전체 매장.
 *
 * 멱등/중복 방지:
 *   lib/automation/alertHooks.ts 의 in-memory dedup 이 (type, store_uuid,
 *   entity_ids) 기준으로 cooldown 동안 skip. cron 주기를 짧게 돌려도 같은
 *   이상은 cooldown 이내에 재발송되지 않음.
 *
 * Non-silent:
 *   - env 누락: Telegram 채널이 env_missing 반환 → 응답 JSON 의 per-store
 *     errors 에 포함. UI/로그로 추적 가능.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Auth helpers (동일 패턴 재사용) ────────────────────────────
function verifyBearer(authHeader: string | null, secret: string): boolean {
  if (!authHeader || !secret) return false
  const prefix = "Bearer "
  if (!authHeader.startsWith(prefix)) return false
  const provided = authHeader.slice(prefix.length).trim()
  if (!provided) return false
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(secret, "utf8")
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}
function verifyVercelCronUA(ua: string | null): boolean {
  return !!ua && /vercel-cron/i.test(ua)
}
function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Thresholds
const THR_DUPLICATE_OPEN = 1
const THR_TAG_MISMATCH = 3
const THR_NO_BUSINESS_DAY = 1

type StoreRow = { id: string; store_name: string | null; is_active: boolean | null }

type ScanEntry = {
  store_uuid: string
  anomalies: {
    duplicate_open: number
    tag_mismatch: number
    no_business_day: number
  }
  emitted: string[] // alert types that actually sent
  deduped: string[] // alert types skipped due to cooldown
  errors: Array<{ type: string; reason: string }>
}

export async function GET(request: Request) {
  // 1. Auth
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  const uaHeader = request.headers.get("user-agent")
  if (!verifyBearer(authHeader, cronSecret) && !verifyVercelCronUA(uaHeader)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  // 2. dry_run 지원
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // 3. 활성 매장 로드
  const { data: stores, error: storesErr } = await supabase
    .from("stores")
    .select("id, store_name, is_active")
    .eq("is_active", true)
    .is("deleted_at", null)
  if (storesErr) {
    return NextResponse.json(
      { ok: false, error: "STORES_LOAD_FAILED", message: storesErr.message },
      { status: 500 },
    )
  }
  const storeRows = (stores ?? []) as StoreRow[]

  const perStore: ScanEntry[] = []
  let totalEmitted = 0
  let totalDeduped = 0
  let totalErrors = 0

  // 4. 매장별 anomaly 계산 + 임계치 초과 시 emit
  for (const s of storeRows) {
    const ov = await computeAttendanceAnomalies(supabase, s.id)
    const entry: ScanEntry = {
      store_uuid: s.id,
      anomalies: {
        duplicate_open: ov.anomalies.duplicate_open,
        tag_mismatch: ov.anomalies.tag_mismatch,
        no_business_day: ov.anomalies.no_business_day,
      },
      emitted: [],
      deduped: [],
      errors: [],
    }

    // 4a. duplicate_open
    if (ov.anomalies.duplicate_open >= THR_DUPLICATE_OPEN) {
      const r = dryRun
        ? ({ ok: true, deduped: false, channel_result: { ok: true, message_id: null } } as const)
        : await emitAutomationAlert({
            type: "duplicate_open",
            store_uuid: s.id,
            store_name: s.store_name,
            entity_ids: ov.sample.duplicate_membership_ids,
            message: `같은 매장·같은 영업일에 중복 출근 ${ov.anomalies.duplicate_open}건 감지. 즉시 확인 필요.`,
          })
      applyResult(entry, "duplicate_open", r)
    }

    // 4b. tag_mismatch (누적 3+)
    if (ov.anomalies.tag_mismatch >= THR_TAG_MISMATCH) {
      const r = dryRun
        ? ({ ok: true, deduped: false, channel_result: { ok: true, message_id: null } } as const)
        : await emitAutomationAlert({
            type: "tag_mismatch",
            store_uuid: s.id,
            store_name: s.store_name,
            entity_ids: ov.sample.mismatch_membership_ids,
            message: `BLE 감지 중 tag 등록 불일치 ${ov.anomalies.tag_mismatch}건. ble_tags 등록 상태 점검 필요.`,
          })
      applyResult(entry, "tag_mismatch", r)
    }

    // 4c. no_business_day
    if (ov.anomalies.no_business_day >= THR_NO_BUSINESS_DAY) {
      const r = dryRun
        ? ({ ok: true, deduped: false, channel_result: { ok: true, message_id: null } } as const)
        : await emitAutomationAlert({
            type: "no_business_day",
            store_uuid: s.id,
            store_name: s.store_name,
            // entity_ids 생략 — 매장 단위 이벤트. key 는 (type, store) 만으로 구성됨.
            message: `영업일이 열리지 않았는데 BLE 가 ${ov.anomalies.no_business_day}명 감지 중. 출근 기록이 저장되지 않습니다.`,
          })
      applyResult(entry, "no_business_day", r)
    }

    totalEmitted += entry.emitted.length
    totalDeduped += entry.deduped.length
    totalErrors += entry.errors.length
    perStore.push(entry)
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    stores_scanned: storeRows.length,
    totals: { emitted: totalEmitted, deduped: totalDeduped, errors: totalErrors },
    per_store: perStore,
  })
}

// ── local helpers ───────────────────────────────────────────────
type EmitLike = Awaited<ReturnType<typeof emitAutomationAlert>>
function applyResult(entry: ScanEntry, type: string, r: EmitLike): void {
  if (r.ok && r.deduped) {
    entry.deduped.push(type)
    return
  }
  if (r.ok && !r.deduped) {
    entry.emitted.push(type)
    return
  }
  if (!r.ok) {
    entry.errors.push({
      type,
      reason: r.channel_result.ok ? "unknown" : r.channel_result.reason,
    })
  }
}
