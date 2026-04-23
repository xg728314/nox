import { describe, it, expect } from "vitest"
import {
  inferWorkType,
  sourceRef,
  WINDOW_SEC,
  DURATION_MIN_SKIP,
  DEFAULT_MIN,
  MAX_OPEN_DURATION_MS,
} from "@/lib/server/queries/bleSessionInference"

describe("locked constants", () => {
  it("WINDOW_SEC = 600 (10분 버킷)", () => {
    expect(WINDOW_SEC).toBe(600)
  })
  it("DURATION_MIN_SKIP = 9 (비즈룰: 0~8분 기본 0원)", () => {
    expect(DURATION_MIN_SKIP).toBe(9)
  })
  it("DEFAULT_MIN = 15 (reaper fallback)", () => {
    expect(DEFAULT_MIN).toBe(15)
  })
  it("MAX_OPEN_DURATION_MS = 4h", () => {
    expect(MAX_OPEN_DURATION_MS).toBe(4 * 60 * 60 * 1000)
  })
})

describe("inferWorkType — duration band mapping", () => {
  it("< 9m → null (skip, not billable)", () => {
    expect(inferWorkType(0)).toBeNull()
    expect(inferWorkType(5 * 60_000)).toBeNull()
    expect(inferWorkType(8 * 60_000 + 59_999)).toBeNull()
  })

  it("9m–15m → cha3", () => {
    expect(inferWorkType(9 * 60_000)).toBe("cha3")
    expect(inferWorkType(12 * 60_000)).toBe("cha3")
    expect(inferWorkType(15 * 60_000)).toBe("cha3")
  })

  it("16m–45m → half", () => {
    expect(inferWorkType(15 * 60_000 + 1)).toBe("half")
    expect(inferWorkType(30 * 60_000)).toBe("half")
    expect(inferWorkType(45 * 60_000)).toBe("half")
  })

  it("> 45m → full", () => {
    expect(inferWorkType(45 * 60_000 + 1)).toBe("full")
    expect(inferWorkType(60 * 60_000)).toBe("full")
    expect(inferWorkType(90 * 60_000)).toBe("full")
    expect(inferWorkType(4 * 60 * 60_000)).toBe("full")
  })

  it("non-finite / negative → null (defensive)", () => {
    expect(inferWorkType(NaN)).toBeNull()
    expect(inferWorkType(-1)).toBeNull()
    expect(inferWorkType(Infinity)).toBeNull()
  })
})

describe("sourceRef — deterministic dedupe key", () => {
  it("same gateway+minor+10min-bucket → identical ref", () => {
    const a = sourceRef("GW1", 42, "2026-04-23T12:00:00.000Z")
    const b = sourceRef("GW1", 42, "2026-04-23T12:09:59.999Z")
    expect(a).toBe(b)
  })

  it("different 10-min bucket → different ref", () => {
    const a = sourceRef("GW1", 42, "2026-04-23T12:00:00.000Z")
    const b = sourceRef("GW1", 42, "2026-04-23T12:10:00.000Z")
    expect(a).not.toBe(b)
  })

  it("different gateway → different ref", () => {
    const a = sourceRef("GW1", 42, "2026-04-23T12:00:00.000Z")
    const b = sourceRef("GW2", 42, "2026-04-23T12:00:00.000Z")
    expect(a).not.toBe(b)
  })

  it("different minor → different ref", () => {
    const a = sourceRef("GW1", 42, "2026-04-23T12:00:00.000Z")
    const b = sourceRef("GW1", 43, "2026-04-23T12:00:00.000Z")
    expect(a).not.toBe(b)
  })

  it("format: 'ble:{gw}:{minor}:{bucket}'", () => {
    const r = sourceRef("GW1", 42, "2026-04-23T12:00:00.000Z")
    expect(r).toMatch(/^ble:GW1:42:\d+$/)
  })

  it("bucket = floor(epoch_sec / WINDOW_SEC)", () => {
    const iso = "2026-04-23T12:00:00.000Z"
    const expected = Math.floor(new Date(iso).getTime() / 1000 / WINDOW_SEC)
    expect(sourceRef("GW", 1, iso)).toBe(`ble:GW:1:${expected}`)
  })
})
