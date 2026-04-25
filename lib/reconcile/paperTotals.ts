/**
 * R28~29: 추출된 종이 JSON 에서 합계 추출 + 정규화.
 *
 * 종이 사람마다 단위가 다를 수 있어 보정:
 *   - 우측 박스 숫자는 만원 단위로 입력됨 (예: 7층 125 = 1,250,000원).
 *   - 셀 안 양주 1.030 같은 표기는 천원 단위로 입력됨.
 *   - amount_won 필드가 이미 원 단위로 정규화돼 있다고 가정 (extract 에서).
 *
 * 이 모듈은 PURE — DB 접근 없음. 테스트 가능.
 */

import type { PaperExtraction, CrossStoreSummary } from "./types"

export type PaperTotals = {
  owe_total_won: number
  recv_total_won: number
  owe_by_store: Record<string, number>
  recv_by_store: Record<string, number>
  liquor_total_won: number
  misu_total_won: number
}

export function computePaperTotals(extr: PaperExtraction): PaperTotals {
  const oweRaw = extr.daily_summary?.owe ?? []
  const recvRaw = extr.daily_summary?.recv ?? []

  const owe_by_store = sumByStore(oweRaw)
  const recv_by_store = sumByStore(recvRaw)
  const owe_total_won = sumValues(owe_by_store)
  const recv_total_won = sumValues(recv_by_store)

  // 양주 합계: extraction.daily_summary.liquor_total_won 우선, 없으면 rooms 셀 합산.
  let liquor_total_won = extr.daily_summary?.liquor_total_won ?? 0
  if (!liquor_total_won && Array.isArray(extr.rooms)) {
    for (const room of extr.rooms) {
      for (const liq of room.liquor ?? []) {
        liquor_total_won += Number.isFinite(liq.amount_won) ? liq.amount_won : 0
      }
    }
  }

  let misu_total_won = extr.daily_summary?.misu_total_won ?? 0
  if (!misu_total_won && Array.isArray(extr.rooms)) {
    for (const room of extr.rooms) {
      misu_total_won += Number.isFinite(room.misu_won as number) ? (room.misu_won ?? 0) : 0
    }
  }

  return {
    owe_total_won,
    recv_total_won,
    owe_by_store,
    recv_by_store,
    liquor_total_won,
    misu_total_won,
  }
}

function sumByStore(rows: CrossStoreSummary[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    if (!r.store_name) continue
    const k = r.store_name.trim()
    if (!k) continue
    const v = Number.isFinite(r.amount_won) ? r.amount_won : 0
    out[k] = (out[k] ?? 0) + v
  }
  return out
}

function sumValues(o: Record<string, number>): number {
  let s = 0
  for (const v of Object.values(o)) s += v
  return s
}
