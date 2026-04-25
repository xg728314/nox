import { describe, it, expect } from "vitest"
import { getBusinessDateKST, getBusinessDateForOps } from "../businessDate"

describe("getBusinessDateKST", () => {
  it("UTC 자정 직전 = KST 다음날 09시", () => {
    // 2026-04-24 23:30:00 UTC = 2026-04-25 08:30 KST
    const d = new Date(Date.UTC(2026, 3, 24, 23, 30, 0))
    expect(getBusinessDateKST(d)).toBe("2026-04-25")
  })

  it("UTC 자정 직후 = KST 09:00 같은 날", () => {
    // 2026-04-25 00:00:00 UTC = 2026-04-25 09:00 KST
    const d = new Date(Date.UTC(2026, 3, 25, 0, 0, 0))
    expect(getBusinessDateKST(d)).toBe("2026-04-25")
  })

  it("UTC 15:00 = KST 자정 (날짜 경계)", () => {
    // UTC 15:00 = KST 24:00 = 다음날 00:00
    const d = new Date(Date.UTC(2026, 3, 24, 15, 0, 0))
    expect(getBusinessDateKST(d)).toBe("2026-04-25")
  })

  it("UTC 14:59 = KST 23:59 같은 날", () => {
    const d = new Date(Date.UTC(2026, 3, 24, 14, 59, 0))
    expect(getBusinessDateKST(d)).toBe("2026-04-24")
  })
})

describe("getBusinessDateForOps", () => {
  it("KST 영업 시작 시각 (저녁) — 당일", () => {
    // 2026-04-24 KST 19:00 = 2026-04-24 UTC 10:00
    const d = new Date(Date.UTC(2026, 3, 24, 10, 0, 0))
    expect(getBusinessDateForOps(d)).toBe("2026-04-24")
  })

  it("KST 자정 직후 (00:30) — 전날 영업일", () => {
    // 2026-04-25 KST 00:30 = 2026-04-24 UTC 15:30
    const d = new Date(Date.UTC(2026, 3, 24, 15, 30, 0))
    expect(getBusinessDateForOps(d)).toBe("2026-04-24")
  })

  it("KST 새벽 5시 — 전날 영업일", () => {
    // 2026-04-25 KST 05:00 = 2026-04-24 UTC 20:00
    const d = new Date(Date.UTC(2026, 3, 24, 20, 0, 0))
    expect(getBusinessDateForOps(d)).toBe("2026-04-24")
  })

  it("KST 06:00 — 새 영업일 시작", () => {
    // 2026-04-25 KST 06:00 = 2026-04-24 UTC 21:00
    const d = new Date(Date.UTC(2026, 3, 24, 21, 0, 0))
    expect(getBusinessDateForOps(d)).toBe("2026-04-25")
  })

  it("KST 정오 — 당일", () => {
    // 2026-04-25 KST 12:00 = 2026-04-25 UTC 03:00
    const d = new Date(Date.UTC(2026, 3, 25, 3, 0, 0))
    expect(getBusinessDateForOps(d)).toBe("2026-04-25")
  })
})
