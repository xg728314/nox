/**
 * R-Paper-Learn (2026-05-01): 매장별 학습된 raw → corrected 매핑 추출.
 *
 * 운영자 의도:
 *   "한 달치 종이장부 사진 학습시키면 매장별 손글씨/약어 패턴 자동 인식.
 *    14매장 다 다른 스타일 OK."
 *
 * 동작:
 *   - learning_signals 테이블에서 store_uuid 기준 raw → corrected 쌍 누적.
 *   - 같은 (signal_type, raw, corrected) 조합 occurrence 계산.
 *   - top-N 만 추출 (prompt token 한도 고려).
 *   - PII 마스킹된 row 제외 (hash 라 prompt 에 넣어도 의미 없음).
 *
 * 사용:
 *   const corrections = await getLearnedCorrectionsByStore(supabase, storeUuid, {
 *     types: ["reconcile.staff.session.store", "reconcile.staff.session.time_tier"],
 *     limit_per_type: 20,
 *   })
 *   → buildExtractionPrompt 의 store_learned_corrections 로 주입.
 *
 * 비용:
 *   - learning_signals 한 번 SELECT (~5000 row 까지 client aggregate).
 *   - 결과는 in-memory cache 가능 (매장 + sheet kind 별).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type LearnedCorrection = {
  type: string
  raw: string
  corrected: string
  occurrences: number
}

export type GetCorrectionsOpts = {
  /** 추출할 signal_type 화이트리스트 (없으면 모든 type). */
  types?: string[]
  /** type 당 최대 row 수 (occurrence 내림차순). */
  limit_per_type?: number
  /** 전체 fetch row cap (DB 부하 방어). */
  fetch_cap?: number
}

const DEFAULT_LIMIT_PER_TYPE = 15
const DEFAULT_FETCH_CAP = 5000

export async function getLearnedCorrectionsByStore(
  supabase: SupabaseClient,
  store_uuid: string,
  opts: GetCorrectionsOpts = {},
): Promise<LearnedCorrection[]> {
  const limitPerType = opts.limit_per_type ?? DEFAULT_LIMIT_PER_TYPE
  const fetchCap = opts.fetch_cap ?? DEFAULT_FETCH_CAP

  let q = supabase
    .from("learning_signals")
    .select("signal_type, raw_value, corrected_value, pii_masked")
    .eq("store_uuid", store_uuid)
    .eq("pii_masked", false) // hash 는 prompt 에 의미 없음
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(fetchCap)

  if (opts.types && opts.types.length > 0) {
    q = q.in("signal_type", opts.types)
  }

  const { data, error } = await q
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[getLearnedCorrections] fetch failed:", error.message)
    return []
  }
  const rows = (data ?? []) as Array<{
    signal_type: string
    raw_value: string | null
    corrected_value: string | null
    pii_masked: boolean
  }>

  // (type, raw, corrected) 별 occurrence 계산.
  type Key = string
  const counts = new Map<Key, LearnedCorrection>()
  for (const r of rows) {
    if (!r.raw_value || !r.corrected_value) continue
    if (r.raw_value === r.corrected_value) continue // 변화 없는 row 제외
    const raw = r.raw_value.trim()
    const corrected = r.corrected_value.trim()
    if (!raw || !corrected) continue
    const key = `${r.signal_type}|${raw}|${corrected}`
    const existing = counts.get(key)
    if (existing) existing.occurrences++
    else counts.set(key, { type: r.signal_type, raw, corrected, occurrences: 1 })
  }

  // type 별 group + top-N 자르기.
  const byType = new Map<string, LearnedCorrection[]>()
  for (const c of counts.values()) {
    const arr = byType.get(c.type) ?? []
    arr.push(c)
    byType.set(c.type, arr)
  }

  const out: LearnedCorrection[] = []
  for (const [, arr] of byType) {
    arr.sort((a, b) => b.occurrences - a.occurrences)
    out.push(...arr.slice(0, limitPerType))
  }

  // 전체 occurrence 내림차순 정렬 (가장 자주 등장하는 패턴이 prompt 위쪽).
  out.sort((a, b) => b.occurrences - a.occurrences)

  return out
}

/**
 * Prompt 주입용 자연어 블록 생성.
 *   매장별 학습된 raw → corrected 매핑을 type 별로 grouping 해서
 *   사람이 읽기 쉬운 마크다운 list 로 변환.
 *
 * 예시 출력:
 *   ## 이 매장의 학습된 표기 패턴 (사람 수정 누적)
 *   ### 매장명 표기:
 *   - "라이ㅂ" → "라이브" (12회 수정)
 *   - "신새계" → "신세계" (8회)
 *   ### 시간등급 표기:
 *   - "(빵)" → "(반차3)" (5회)
 */
export function formatLearnedCorrectionsForPrompt(
  corrections: LearnedCorrection[],
): string {
  if (corrections.length === 0) return ""

  // type → 사람-친화 라벨 매핑.
  const TYPE_LABEL: Record<string, string> = {
    "reconcile.staff.session.store": "매장명 표기",
    "reconcile.staff.session.time_tier": "시간등급 (반티/완티/차3 등)",
    "reconcile.staff.session.service_type": "종목 (퍼블릭/셔츠/하퍼)",
    "reconcile.staff.session.time": "시간 표기",
    "reconcile.staff.hostess_name": "스태프 이름",
    "reconcile.rooms.staff.origin_store": "스태프 소속 매장",
    "reconcile.rooms.staff.service_type": "룸 셀 종목",
    "reconcile.rooms.staff.time_tier": "룸 셀 시간등급",
    "reconcile.rooms.staff.hostess_name": "룸 셀 스태프 이름",
    "reconcile.rooms.manager_name": "실장 이름",
    "reconcile.rooms.customer_name": "손님 이름",
  }

  const grouped = new Map<string, LearnedCorrection[]>()
  for (const c of corrections) {
    const arr = grouped.get(c.type) ?? []
    arr.push(c)
    grouped.set(c.type, arr)
  }

  const lines: string[] = ["## 이 매장의 학습된 표기 패턴 (사람 수정 누적)"]
  lines.push(
    "아래 패턴들은 과거 이 매장 종이장부에서 운영자가 직접 수정한 결과입니다.",
    "동일 표기를 만나면 **동일하게** corrected 값으로 박으세요. 추측 우선순위 1순위.",
    "",
  )
  for (const [type, arr] of grouped) {
    const label = TYPE_LABEL[type] ?? type
    lines.push(`### ${label}`)
    for (const c of arr) {
      const occ = c.occurrences > 1 ? ` (${c.occurrences}회 누적)` : ""
      lines.push(`- "${c.raw}" → "${c.corrected}"${occ}`)
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}
