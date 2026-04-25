import { describe, it, expect } from "vitest"
import { computeReconcile, DEFAULT_TOLERANCE_WON } from "../match"
import type { PaperTotals } from "../paperTotals"
import type { DbAggregate } from "../dbAggregate"

function paper(over: Partial<PaperTotals> = {}): PaperTotals {
  return {
    owe_total_won: 0, recv_total_won: 0,
    owe_by_store: {}, recv_by_store: {},
    liquor_total_won: 0, misu_total_won: 0,
    ...over,
  }
}
function db(over: Partial<DbAggregate> = {}): DbAggregate {
  return {
    store_uuid: "s", business_date: "2026-04-24",
    owe_by_store: {}, recv_by_store: {},
    owe_total_won: 0, recv_total_won: 0,
    liquor_total_won: 0, misu_total_won: 0,
    has_data: false,
    ...over,
  }
}

describe("computeReconcile", () => {
  it("완전 일치 → match", () => {
    const p = paper({
      owe_by_store: { 토끼: 880_000 },
      recv_by_store: { 라이브: 790_000 },
      owe_total_won: 880_000, recv_total_won: 790_000,
    })
    const d = db({
      owe_by_store: { 토끼: 880_000 },
      recv_by_store: { 라이브: 790_000 },
      owe_total_won: 880_000, recv_total_won: 790_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("match")
    expect(r.item_diffs.every(x => x.status === "match")).toBe(true)
  })

  it("DB 데이터 없음 → no_db_data", () => {
    const p = paper({
      owe_by_store: { 토끼: 880_000 },
      owe_total_won: 880_000,
    })
    const d = db({ has_data: false })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("no_db_data")
  })

  it("종이만 있음 → paper_only + partial", () => {
    const p = paper({
      owe_by_store: { 토끼: 880_000, 발리: 550_000 },
      owe_total_won: 1_430_000,
    })
    const d = db({
      owe_by_store: { 토끼: 880_000 },
      owe_total_won: 880_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("partial")
    const balli = r.item_diffs.find(x => x.key === "발리")
    expect(balli?.status).toBe("paper_only")
  })

  it("DB 만 있음 → db_only", () => {
    const p = paper({})
    const d = db({
      owe_by_store: { 황진이: 280_000 },
      owe_total_won: 280_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("partial")
    const huang = r.item_diffs.find(x => x.key === "황진이")
    expect(huang?.status).toBe("db_only")
  })

  it("금액 불일치 (tolerance 초과) → mismatch", () => {
    const p = paper({
      owe_by_store: { 토끼: 880_000 },
      owe_total_won: 880_000,
    })
    const d = db({
      owe_by_store: { 토끼: 850_000 }, // 30,000원 차이 — tolerance 1,000 초과
      owe_total_won: 850_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("mismatch")
    const item = r.item_diffs.find(x => x.key === "토끼")
    expect(item?.status).toBe("mismatch")
    expect(item?.diff_won).toBe(30_000)
  })

  it("tolerance 이내 차이는 match (반올림 노이즈)", () => {
    const p = paper({
      owe_by_store: { 토끼: 880_500 },
      owe_total_won: 880_500,
    })
    const d = db({
      owe_by_store: { 토끼: 880_000 },
      owe_total_won: 880_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    expect(r.match_status).toBe("match")
  })

  it("커스텀 tolerance 적용 — 양쪽에 같은 매장 row 가 있을 때만 mismatch 분기", () => {
    // 양쪽에 토끼 row 둘 다 존재 (DB 도 명시적으로 100_000 row 있음).
    const p = paper({ owe_by_store: { 토끼: 150_000 }, owe_total_won: 150_000 })
    const d = db({ owe_by_store: { 토끼: 100_000 }, owe_total_won: 100_000, has_data: true })
    // 차이 50,000 — tolerance 1,000 이면 mismatch, 100,000 이면 match.
    expect(computeReconcile(p, d, 1_000).match_status).toBe("mismatch")
    expect(computeReconcile(p, d, 100_000).match_status).toBe("match")
  })

  it("양주/미수 합계도 비교", () => {
    const p = paper({
      liquor_total_won: 3_880_000,
      misu_total_won: 840_000,
    })
    const d = db({
      liquor_total_won: 3_880_000,
      misu_total_won: 840_000,
      has_data: true,
    })
    const r = computeReconcile(p, d)
    const liq = r.item_diffs.find(x => x.category === "liquor_total")
    const misu = r.item_diffs.find(x => x.category === "misu_total")
    expect(liq?.status).toBe("match")
    expect(misu?.status).toBe("match")
  })

  it("기본 tolerance 1,000원", () => {
    expect(DEFAULT_TOLERANCE_WON).toBe(1_000)
  })
})
