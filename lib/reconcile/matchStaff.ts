/**
 * R-Staff (2026-04-30): 종이 staff sheet ↔ DB session_participants 비교.
 *
 * 매칭 단위: hostess 1명 / 1일.
 *   paper 의 PaperStaffRow.hostess_name ↔ DB rows.name (hostesses.name)
 *
 * 매칭 정책:
 *   1. 정확 일치 (trim 후 동일).
 *   2. 부분 일치 (paper 이름이 DB 이름의 substring 또는 그 반대).
 *      예: paper '예린' ↔ DB '예린이' / DB '예린'.
 *   3. 매칭 실패 시 paper_only / db_only ItemDiff 추가.
 *
 * 비교 항목 (StaffItemDiff):
 *   - tc_count: paper.sessions.length vs db.tc_count
 *   - payout:   paper 합계 (hostess_payout_won 합) vs db.total_payout_won
 *
 * tolerance:
 *   - tc_count 는 정수 — 0 차이만 match.
 *   - payout 는 1,000원 (반올림 노이즈 흡수).
 */

import type { PaperExtraction, PaperStaffRow, MatchStatus, ServiceType } from "./types"
import type { StaffDailyAggregate, StaffDailyRow } from "./dbAggregateStaff"

export type StaffItemDiff = {
  /** "tc" = TC 건수 비교 / "payout" = 지급액 비교. */
  category: "tc" | "payout"
  /** hostess 이름 (display key). */
  key: string
  paper_value: number
  db_value: number
  diff: number
  status: "match" | "mismatch" | "paper_only" | "db_only"
}

export type StaffReconcileResult = {
  match_status: MatchStatus
  by_hostess: Array<{
    name: string
    paper_tc: number
    db_tc: number
    paper_payout_won: number
    db_payout_won: number
    paper_categories: Record<ServiceType, number>     // 종이 측 종목별 카운트
    db_categories: Record<ServiceType, number>        // DB 측 종목별 카운트
    origin_store: string | null
    tc_diff_status: StaffItemDiff["status"]
    payout_diff_status: StaffItemDiff["status"]
  }>
  paper_total_tc: number
  db_total_tc: number
  paper_total_payout_won: number
  db_total_payout_won: number
  /** 정렬된 ItemDiff 평면 리스트 — 기존 ItemDiff[] 와 호환 가능한 보조 출력. */
  item_diffs: StaffItemDiff[]
  tolerance_won: number
  computed_at: string
}

const PAYOUT_TOLERANCE_WON = 1_000

const SERVICE_KEYS: ServiceType[] = ["퍼블릭", "셔츠", "하퍼"]

function emptyByCategory(): Record<ServiceType, number> {
  return { 퍼블릭: 0, 셔츠: 0, 하퍼: 0 }
}

function trimName(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, "").trim()
}

/** paper name ↔ db name 부분 매칭. 둘 다 빈 문자열은 매칭 X. */
function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 2 && b.includes(a)) return true
  if (b.length >= 2 && a.includes(b)) return true
  return false
}

/** PaperStaffRow → 단일 hostess 측정값 (paper 측). */
function summarizePaperRow(row: PaperStaffRow): {
  tc: number
  payout: number
  categories: Record<ServiceType, number>
} {
  const categories = emptyByCategory()
  let payout = 0
  const sessions = row.sessions ?? []
  for (const s of sessions) {
    const sv = s.service_type
    if (sv && SERVICE_KEYS.includes(sv)) categories[sv] += 1
    // PaperStaffRow.sessions 의 hostess_payout_won 은 type 에 없으므로
    //   raw extraction 에서 별도로 들어올 가능성만 — best-effort 합산.
    const anyS = s as unknown as { hostess_payout_won?: number }
    if (typeof anyS.hostess_payout_won === "number") payout += anyS.hostess_payout_won
  }
  // daily_totals 의 "지급금액" 으로 추정될 수 있는 가장 큰 값을 fallback.
  if (payout === 0 && row.daily_totals && row.daily_totals.length > 0) {
    const max = Math.max(...row.daily_totals)
    if (max > 10_000) payout = max // 단순 휴리스틱 — 1만원 이상이면 지급액 후보
  }
  return { tc: sessions.length, payout, categories }
}

export function computeStaffReconcile(
  extraction: PaperExtraction,
  dbAgg: StaffDailyAggregate,
): StaffReconcileResult {
  const paperRows = (extraction.staff ?? []) as PaperStaffRow[]
  const dbRows = dbAgg.rows

  const usedDbIdx = new Set<number>()
  const byHostess: StaffReconcileResult["by_hostess"] = []
  const itemDiffs: StaffItemDiff[] = []

  let paperTotalTc = 0
  let paperTotalPayout = 0

  // 1) paper rows → match each to db
  for (const pr of paperRows) {
    const pName = trimName(pr.hostess_name)
    if (!pName) continue
    const summary = summarizePaperRow(pr)
    paperTotalTc += summary.tc
    paperTotalPayout += summary.payout

    let matchedIdx = -1
    for (let i = 0; i < dbRows.length; i++) {
      if (usedDbIdx.has(i)) continue
      if (nameMatches(pName, trimName(dbRows[i].name))) {
        matchedIdx = i
        break
      }
    }

    if (matchedIdx === -1) {
      // paper_only
      itemDiffs.push({
        category: "tc", key: pName, paper_value: summary.tc, db_value: 0,
        diff: summary.tc, status: "paper_only",
      })
      itemDiffs.push({
        category: "payout", key: pName, paper_value: summary.payout, db_value: 0,
        diff: summary.payout, status: summary.payout > 0 ? "paper_only" : "match",
      })
      byHostess.push({
        name: pName,
        paper_tc: summary.tc,
        db_tc: 0,
        paper_payout_won: summary.payout,
        db_payout_won: 0,
        paper_categories: summary.categories,
        db_categories: emptyByCategory(),
        origin_store: null,
        tc_diff_status: "paper_only",
        payout_diff_status: summary.payout > 0 ? "paper_only" : "match",
      })
      continue
    }

    usedDbIdx.add(matchedIdx)
    const db = dbRows[matchedIdx]
    const tcDiff = summary.tc - db.tc_count
    const payoutDiff = summary.payout - db.total_payout_won
    const tcStatus: StaffItemDiff["status"] = tcDiff === 0 ? "match" : "mismatch"
    const payoutStatus: StaffItemDiff["status"] =
      Math.abs(payoutDiff) <= PAYOUT_TOLERANCE_WON ? "match" : "mismatch"

    itemDiffs.push({
      category: "tc", key: pName, paper_value: summary.tc, db_value: db.tc_count,
      diff: tcDiff, status: tcStatus,
    })
    itemDiffs.push({
      category: "payout", key: pName, paper_value: summary.payout, db_value: db.total_payout_won,
      diff: payoutDiff, status: payoutStatus,
    })

    byHostess.push({
      name: db.name,
      paper_tc: summary.tc,
      db_tc: db.tc_count,
      paper_payout_won: summary.payout,
      db_payout_won: db.total_payout_won,
      paper_categories: summary.categories,
      db_categories: db.by_category,
      origin_store: db.origin_store,
      tc_diff_status: tcStatus,
      payout_diff_status: payoutStatus,
    })
  }

  // 2) unmatched DB rows → db_only
  for (let i = 0; i < dbRows.length; i++) {
    if (usedDbIdx.has(i)) continue
    const db = dbRows[i]
    itemDiffs.push({
      category: "tc", key: db.name, paper_value: 0, db_value: db.tc_count,
      diff: -db.tc_count, status: "db_only",
    })
    itemDiffs.push({
      category: "payout", key: db.name, paper_value: 0, db_value: db.total_payout_won,
      diff: -db.total_payout_won, status: db.total_payout_won > 0 ? "db_only" : "match",
    })
    byHostess.push({
      name: db.name,
      paper_tc: 0,
      db_tc: db.tc_count,
      paper_payout_won: 0,
      db_payout_won: db.total_payout_won,
      paper_categories: emptyByCategory(),
      db_categories: db.by_category,
      origin_store: db.origin_store,
      tc_diff_status: "db_only",
      payout_diff_status: db.total_payout_won > 0 ? "db_only" : "match",
    })
  }

  const hasMismatch = itemDiffs.some((d) => d.status === "mismatch")
  const hasPartial = itemDiffs.some((d) => d.status === "paper_only" || d.status === "db_only")
  let match_status: MatchStatus
  if (!dbAgg.has_data && paperRows.length === 0) match_status = "no_db_data"
  else if (hasMismatch) match_status = "mismatch"
  else if (hasPartial) match_status = "partial"
  else match_status = "match"

  return {
    match_status,
    by_hostess: byHostess,
    paper_total_tc: paperTotalTc,
    db_total_tc: dbAgg.total_tc,
    paper_total_payout_won: paperTotalPayout,
    db_total_payout_won: dbAgg.total_payout_won,
    item_diffs: itemDiffs,
    tolerance_won: PAYOUT_TOLERANCE_WON,
    computed_at: new Date().toISOString(),
  }
}
