/**
 * R29: 종이 ↔ DB sum-anchored 비교.
 *
 * 핵심 전략 (사용자 인사이트):
 *   "줄돈/받을돈 정산금액으로 유추해야 한다" — 셀 단위 OCR 정확도에
 *   의존하지 않고 합계가 맞는지 본다. 합계가 맞으면 그날 데이터 OK.
 *
 * 결과:
 *   - match: 모든 항목이 tolerance 이내
 *   - partial: 일부만 일치 (모르는 매장/누락된 항목 있어도 일치는 일치)
 *   - mismatch: 1개 이상 항목 차이 > tolerance
 *   - no_db_data: DB 측이 비어있음 (그날 NOX 입력 자체가 없음)
 *
 * 매장 이름 정규화:
 *   - 종이 (한글 store name) ↔ DB (한글 store_name) 양쪽 trim 으로 매칭.
 *   - 한쪽에만 있는 매장도 별도 row 로 표시 (paper_only / db_only).
 */

import type { ReconcileResult, ItemDiff } from "./types"
import type { PaperTotals } from "./paperTotals"
import type { DbAggregate } from "./dbAggregate"

/** 매장별 정산 비교 시 노이즈 흡수 허용 (반올림/100원 단위 차이). */
export const DEFAULT_TOLERANCE_WON = 1_000

export function computeReconcile(
  paper: PaperTotals,
  db: DbAggregate,
  tolerance_won: number = DEFAULT_TOLERANCE_WON,
): ReconcileResult {
  const item_diffs: ItemDiff[] = []

  // 1) owe by store
  const oweKeys = new Set<string>([...Object.keys(paper.owe_by_store), ...Object.keys(db.owe_by_store)])
  for (const k of oweKeys) {
    const p = paper.owe_by_store[k] ?? 0
    const d = db.owe_by_store[k] ?? 0
    item_diffs.push(makeItemDiff("owe", k, p, d, tolerance_won))
  }

  // 2) recv by store
  const recvKeys = new Set<string>([...Object.keys(paper.recv_by_store), ...Object.keys(db.recv_by_store)])
  for (const k of recvKeys) {
    const p = paper.recv_by_store[k] ?? 0
    const d = db.recv_by_store[k] ?? 0
    item_diffs.push(makeItemDiff("recv", k, p, d, tolerance_won))
  }

  // 3) liquor / misu 총합
  if (paper.liquor_total_won > 0 || db.liquor_total_won > 0) {
    item_diffs.push(makeItemDiff("liquor_total", "_total", paper.liquor_total_won, db.liquor_total_won, tolerance_won))
  }
  if (paper.misu_total_won > 0 || db.misu_total_won > 0) {
    item_diffs.push(makeItemDiff("misu_total", "_total", paper.misu_total_won, db.misu_total_won, tolerance_won))
  }

  const match_status = classify(item_diffs, db.has_data)

  return {
    match_status,
    item_diffs,
    paper_owe_total_won: paper.owe_total_won,
    paper_recv_total_won: paper.recv_total_won,
    db_owe_total_won: db.owe_total_won,
    db_recv_total_won: db.recv_total_won,
    tolerance_won,
    computed_at: new Date().toISOString(),
  }
}

function makeItemDiff(
  category: ItemDiff["category"],
  key: string,
  paper_won: number,
  db_won: number,
  tolerance: number,
): ItemDiff {
  const diff_won = paper_won - db_won
  let status: ItemDiff["status"]
  if (paper_won === 0 && db_won > 0) status = "db_only"
  else if (db_won === 0 && paper_won > 0) status = "paper_only"
  else if (Math.abs(diff_won) <= tolerance) status = "match"
  else status = "mismatch"
  return { category, key, paper_won, db_won, diff_won, status }
}

function classify(diffs: ItemDiff[], dbHasData: boolean): ReconcileResult["match_status"] {
  if (!dbHasData && diffs.every(d => d.db_won === 0)) {
    return "no_db_data"
  }
  if (diffs.length === 0) return "match"
  const hasMismatch = diffs.some(d => d.status === "mismatch")
  const hasPartial = diffs.some(d => d.status === "paper_only" || d.status === "db_only")
  if (hasMismatch) return "mismatch"
  if (hasPartial) return "partial"
  return "match"
}
