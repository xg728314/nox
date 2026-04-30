/**
 * R-Learn-Corpus (2026-04-30): 사람-수정 학습 시그널 캡처 헬퍼.
 *
 * 운영자 의도:
 *   "모든 데이터는 학습하는 기능. 적용은 하지 마라.
 *    어플 만들 때 더 완벽해지도록 corpus 누적."
 *
 * 사용:
 *   await captureLearningSignals(supabase, {
 *     store_uuid, user_id,
 *     signals: [
 *       { type: "reconcile.staff.hostess_name", raw: "선앙(계)", corrected: "선앙" },
 *       { type: "reconcile.staff.session.store", raw: "라이ㅂ", corrected: "라이브" },
 *     ],
 *     context: { snapshot_id, business_date },
 *   })
 *
 * 정책:
 *   - 적용 안 함. learning_signals 에 row insert 만.
 *   - PII 마스킹: hostess_name / customer_name / phone 같은 signal_type 은
 *     자동 hash 처리. signal_type prefix 로 판정.
 *   - 실패 시 throw 안 함 (fire-and-forget). 호출자가 try/catch 없이 .catch().
 *   - 빈 raw == corrected 인 경우 skip (변화 없음 = 학습 가치 없음).
 *
 * Privacy:
 *   - hostess_name, customer_name, phone, email → SHA-256 hash + 4 hex prefix
 *     ("h_a3f2..." 형식). 사람 이름 평문 보관 X.
 *   - store_name, item_name 등 사업 데이터는 평문 (PII 아님).
 *
 * 데이터 활용 (별도 라운드):
 *   - 운영자가 /api/learn/export 호출 → 매장별 csv/json 추출
 *   - 외부 모델 fine-tune / Anthropic batch 학습 등
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createHash } from "crypto"

export type Signal = {
  /** 자유 식별자. 예: "reconcile.staff.hostess_name". */
  type: string
  /** AI / 시스템이 만든 원본. 빈 문자열이면 사람이 직접 추가한 데이터. */
  raw?: string | null
  /** 사람이 수정한 / 확정한 값. */
  corrected?: string | null
}

export type CaptureInput = {
  store_uuid?: string | null
  user_id?: string | null
  signals: Signal[]
  context?: Record<string, unknown>
  source_model?: string | null
  source_prompt_version?: number | null
}

/** 신호 type prefix 가 PII 인지 판정. 매칭되면 raw/corrected hash 처리. */
const PII_TYPE_PATTERNS = [
  /\.hostess_name(\.|$)/,
  /\.customer_name(\.|$)/,
  /\.manager_name(\.|$)/,
  /\.phone(\.|$)/,
  /\.email(\.|$)/,
  /\.full_name(\.|$)/,
]

function isPiiType(type: string): boolean {
  return PII_TYPE_PATTERNS.some((re) => re.test(type))
}

function hashPii(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (trimmed.length === 0) return null
  // SHA-256 hex 8자만 (충돌 방지엔 충분, raw 복원 불가).
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 16)
  return `h_${digest}`
}

/**
 * 시그널 다중 insert. 비어있는 / 변화 없는 row 는 skip.
 * 실패해도 throw 안 함 — 호출자는 .catch(() => {}) 또는 await 후 무시.
 */
export async function captureLearningSignals(
  supabase: SupabaseClient,
  input: CaptureInput,
): Promise<{ inserted: number; skipped: number }> {
  const rows: Array<{
    store_uuid: string | null
    user_id: string | null
    signal_type: string
    raw_value: string | null
    corrected_value: string | null
    pii_masked: boolean
    context: Record<string, unknown>
    source_model: string | null
    source_prompt_version: number | null
  }> = []
  let skipped = 0

  for (const sig of input.signals) {
    if (!sig.type || sig.type.length < 3) { skipped++; continue }
    const rawTrim = sig.raw == null ? null : String(sig.raw).trim()
    const corTrim = sig.corrected == null ? null : String(sig.corrected).trim()
    // 변화 없으면 skip (학습 가치 없음).
    if (rawTrim === corTrim && (!rawTrim || rawTrim.length === 0)) { skipped++; continue }
    if (rawTrim === corTrim) { skipped++; continue }

    const isPii = isPiiType(sig.type)
    rows.push({
      store_uuid: input.store_uuid ?? null,
      user_id: input.user_id ?? null,
      signal_type: sig.type,
      raw_value: isPii ? hashPii(rawTrim) : (rawTrim ?? null),
      corrected_value: isPii ? hashPii(corTrim) : (corTrim ?? null),
      pii_masked: isPii,
      context: input.context ?? {},
      source_model: input.source_model ?? null,
      source_prompt_version: input.source_prompt_version ?? null,
    })
  }

  if (rows.length === 0) return { inserted: 0, skipped }

  try {
    const { error } = await supabase.from("learning_signals").insert(rows)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[learning_signals] insert failed:", error.message)
      return { inserted: 0, skipped: skipped + rows.length }
    }
    return { inserted: rows.length, skipped }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[learning_signals] catastrophic:", (e as Error).message)
    return { inserted: 0, skipped: skipped + rows.length }
  }
}

/**
 * 두 PaperExtraction 의 staff/rooms 비교해서 (raw, corrected) signal 자동 생성.
 * /api/reconcile/[id]/edit 가 base_extraction 과 edited_json 비교 시 사용.
 */
export function diffExtractionsToSignals(
  base: { staff?: unknown[]; rooms?: unknown[] } | null | undefined,
  edited: { staff?: unknown[]; rooms?: unknown[] } | null | undefined,
): Signal[] {
  const out: Signal[] = []
  if (!base || !edited) return out

  // staff sheet
  const baseStaff = (base.staff ?? []) as Array<{
    hostess_name?: string
    sessions?: Array<{ time?: string; store?: string; service_type?: string; time_tier?: string; raw_text?: string }>
  }>
  const edStaff = (edited.staff ?? []) as Array<{
    hostess_name?: string
    sessions?: Array<{ time?: string; store?: string; service_type?: string; time_tier?: string; raw_text?: string }>
  }>
  const minStaff = Math.min(baseStaff.length, edStaff.length)
  for (let i = 0; i < minStaff; i++) {
    const b = baseStaff[i]
    const e = edStaff[i]
    if (b.hostess_name !== e.hostess_name) {
      out.push({ type: "reconcile.staff.hostess_name", raw: b.hostess_name, corrected: e.hostess_name })
    }
    const minSess = Math.min((b.sessions ?? []).length, (e.sessions ?? []).length)
    for (let j = 0; j < minSess; j++) {
      const bs = (b.sessions ?? [])[j]
      const es = (e.sessions ?? [])[j]
      if (bs.time !== es.time) {
        out.push({ type: "reconcile.staff.session.time", raw: bs.time, corrected: es.time })
      }
      if (bs.store !== es.store) {
        out.push({ type: "reconcile.staff.session.store", raw: bs.store, corrected: es.store })
      }
      if (bs.service_type !== es.service_type) {
        out.push({ type: "reconcile.staff.session.service_type", raw: bs.service_type, corrected: es.service_type })
      }
      if (bs.time_tier !== es.time_tier) {
        out.push({ type: "reconcile.staff.session.time_tier", raw: bs.time_tier, corrected: es.time_tier })
      }
    }
  }

  // rooms sheet
  const baseRooms = (base.rooms ?? []) as Array<{
    manager_name?: string
    customer_name?: string
    staff_entries?: Array<{ hostess_name?: string; origin_store?: string; service_type?: string; time_tier?: string }>
  }>
  const edRooms = (edited.rooms ?? []) as Array<{
    manager_name?: string
    customer_name?: string
    staff_entries?: Array<{ hostess_name?: string; origin_store?: string; service_type?: string; time_tier?: string }>
  }>
  const minRooms = Math.min(baseRooms.length, edRooms.length)
  for (let i = 0; i < minRooms; i++) {
    const b = baseRooms[i]
    const e = edRooms[i]
    if (b.manager_name !== e.manager_name) {
      out.push({ type: "reconcile.rooms.manager_name", raw: b.manager_name, corrected: e.manager_name })
    }
    if (b.customer_name !== e.customer_name) {
      out.push({ type: "reconcile.rooms.customer_name", raw: b.customer_name, corrected: e.customer_name })
    }
    const minE = Math.min((b.staff_entries ?? []).length, (e.staff_entries ?? []).length)
    for (let j = 0; j < minE; j++) {
      const bs = (b.staff_entries ?? [])[j]
      const es = (e.staff_entries ?? [])[j]
      if (bs.hostess_name !== es.hostess_name) {
        out.push({ type: "reconcile.rooms.staff.hostess_name", raw: bs.hostess_name, corrected: es.hostess_name })
      }
      if (bs.origin_store !== es.origin_store) {
        out.push({ type: "reconcile.rooms.staff.origin_store", raw: bs.origin_store, corrected: es.origin_store })
      }
      if (bs.service_type !== es.service_type) {
        out.push({ type: "reconcile.rooms.staff.service_type", raw: bs.service_type, corrected: es.service_type })
      }
      if (bs.time_tier !== es.time_tier) {
        out.push({ type: "reconcile.rooms.staff.time_tier", raw: bs.time_tier, corrected: es.time_tier })
      }
    }
  }

  return out
}
