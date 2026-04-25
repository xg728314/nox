import { describe, it, expect } from "vitest"
import { computePaperTotals } from "../paperTotals"
import type { PaperExtraction } from "../types"

const baseRoomsExtraction: PaperExtraction = {
  schema_version: 1,
  sheet_kind: "rooms",
  business_date: "2026-04-24",
  rooms: [
    {
      room_no: "1T",
      session_seq: 1,
      manager_name: "태혁",
      customer_name: "세호",
      headcount: 2,
      liquor: [{ brand: "골든블루", amount_won: 1_030_000 }],
      misu_won: 0,
    },
    {
      room_no: "3T",
      session_seq: 2,
      manager_name: "준성",
      liquor: [{ brand: "골든블루", amount_won: 0 }],
      misu_won: 840_000,
    },
  ],
  daily_summary: {
    owe: [
      { store_name: "토끼", amount_won: 880_000 },
      { store_name: "발리", amount_won: 550_000 },
      { store_name: "황진이", amount_won: 280_000 },
    ],
    recv: [
      { store_name: "라이브", amount_won: 790_000 },
      { store_name: "7층", amount_won: 1_250_000 },
    ],
  },
  unknown_tokens: [],
}

describe("computePaperTotals", () => {
  it("줄돈 / 받돈 합계 정확", () => {
    const t = computePaperTotals(baseRoomsExtraction)
    expect(t.owe_total_won).toBe(880_000 + 550_000 + 280_000)
    expect(t.recv_total_won).toBe(790_000 + 1_250_000)
  })

  it("매장별 분해", () => {
    const t = computePaperTotals(baseRoomsExtraction)
    expect(t.owe_by_store["토끼"]).toBe(880_000)
    expect(t.recv_by_store["7층"]).toBe(1_250_000)
  })

  it("daily_summary 에 양주 합계 없으면 rooms 셀 합산", () => {
    const t = computePaperTotals(baseRoomsExtraction)
    expect(t.liquor_total_won).toBe(1_030_000)
  })

  it("미수도 셀 합산", () => {
    const t = computePaperTotals(baseRoomsExtraction)
    expect(t.misu_total_won).toBe(840_000)
  })

  it("같은 매장 row 두 개면 합쳐짐", () => {
    const e: PaperExtraction = {
      ...baseRoomsExtraction,
      daily_summary: {
        owe: [
          { store_name: "토끼", amount_won: 500_000 },
          { store_name: "토끼", amount_won: 380_000 },
        ],
        recv: [],
      },
    }
    const t = computePaperTotals(e)
    expect(t.owe_by_store["토끼"]).toBe(880_000)
    expect(t.owe_total_won).toBe(880_000)
  })

  it("amount_won 이 NaN/Infinity 면 0 처리", () => {
    const e: PaperExtraction = {
      ...baseRoomsExtraction,
      daily_summary: {
        owe: [
          { store_name: "토끼", amount_won: NaN as unknown as number },
          { store_name: "발리", amount_won: 500_000 },
        ],
        recv: [],
      },
    }
    const t = computePaperTotals(e)
    expect(t.owe_total_won).toBe(500_000)
  })

  it("빈 extraction 도 안전하게 0", () => {
    const e: PaperExtraction = {
      schema_version: 1,
      sheet_kind: "other",
      unknown_tokens: [],
    }
    const t = computePaperTotals(e)
    expect(t.owe_total_won).toBe(0)
    expect(t.recv_total_won).toBe(0)
    expect(t.liquor_total_won).toBe(0)
  })
})
