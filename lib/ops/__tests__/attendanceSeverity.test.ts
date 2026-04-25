import { describe, it, expect } from "vitest"
import {
  classifySeverity,
  hasBlocking,
  hasWarning,
  isBlockingAnomaly,
  isWarningAnomaly,
  listBlockingDetails,
  listWarningDetails,
  summarizeAnomalies,
  BLOCKING_TYPES,
  WARN_TYPES,
  type AnomalyCounts,
} from "@/lib/ops/attendanceSeverity"

const zero: AnomalyCounts = {
  duplicate_open: 0,
  recent_checkout_block: 0,
  tag_mismatch: 0,
  no_business_day: 0,
}

describe("attendanceSeverity — BLOCKING/WARN 분류 불변성", () => {
  it("BLOCKING_TYPES 는 duplicate_open + no_business_day 2종", () => {
    expect(new Set(BLOCKING_TYPES)).toEqual(new Set(["duplicate_open", "no_business_day"]))
  })
  it("WARN_TYPES 는 tag_mismatch + recent_checkout_block 2종", () => {
    expect(new Set(WARN_TYPES)).toEqual(new Set(["tag_mismatch", "recent_checkout_block"]))
  })
})

describe("classifySeverity", () => {
  it("모두 0 → ok", () => {
    expect(classifySeverity(zero)).toBe("ok")
  })
  it("duplicate_open 1건 → blocking", () => {
    expect(classifySeverity({ ...zero, duplicate_open: 1 })).toBe("blocking")
  })
  it("no_business_day 1건 → blocking", () => {
    expect(classifySeverity({ ...zero, no_business_day: 1 })).toBe("blocking")
  })
  it("tag_mismatch 1건만 → warn (blocking 아님)", () => {
    expect(classifySeverity({ ...zero, tag_mismatch: 1 })).toBe("warn")
  })
  it("recent_checkout_block 1건만 → warn", () => {
    expect(classifySeverity({ ...zero, recent_checkout_block: 1 })).toBe("warn")
  })
  it("tag_mismatch 100건이어도 → warn (blocking 아님)", () => {
    expect(classifySeverity({ ...zero, tag_mismatch: 100 })).toBe("warn")
  })
  it("blocking + warn 동시 → blocking 우선", () => {
    expect(
      classifySeverity({
        duplicate_open: 1,
        tag_mismatch: 5,
        recent_checkout_block: 2,
        no_business_day: 0,
      }),
    ).toBe("blocking")
  })
})

describe("hasBlocking / hasWarning", () => {
  it("blocking 없고 warn 있음 → hasBlocking=false, hasWarning=true", () => {
    const a = { ...zero, tag_mismatch: 1 }
    expect(hasBlocking(a)).toBe(false)
    expect(hasWarning(a)).toBe(true)
  })
  it("blocking 있고 warn 없음 → hasBlocking=true, hasWarning=false", () => {
    const a = { ...zero, duplicate_open: 1 }
    expect(hasBlocking(a)).toBe(true)
    expect(hasWarning(a)).toBe(false)
  })
  it("둘 다 있음 → hasBlocking=true, hasWarning=true", () => {
    const a = { duplicate_open: 1, tag_mismatch: 1, recent_checkout_block: 0, no_business_day: 0 }
    expect(hasBlocking(a)).toBe(true)
    expect(hasWarning(a)).toBe(true)
  })
})

describe("isBlockingAnomaly / isWarningAnomaly", () => {
  it("duplicate_open 1 → blocking=true", () => {
    expect(isBlockingAnomaly("duplicate_open", 1)).toBe(true)
    expect(isWarningAnomaly("duplicate_open", 1)).toBe(false)
  })
  it("tag_mismatch 1 → warning=true", () => {
    expect(isWarningAnomaly("tag_mismatch", 1)).toBe(true)
    expect(isBlockingAnomaly("tag_mismatch", 1)).toBe(false)
  })
  it("count 0 → 어느 쪽도 true 아님", () => {
    expect(isBlockingAnomaly("duplicate_open", 0)).toBe(false)
    expect(isWarningAnomaly("tag_mismatch", 0)).toBe(false)
  })
  it("정의되지 않은 type → 어느 쪽도 true 아님", () => {
    expect(isBlockingAnomaly("unknown_type", 5)).toBe(false)
    expect(isWarningAnomaly("unknown_type", 5)).toBe(false)
  })
})

describe("listBlockingDetails / listWarningDetails", () => {
  it("모두 0 → 빈 배열", () => {
    expect(listBlockingDetails(zero)).toEqual([])
    expect(listWarningDetails(zero)).toEqual([])
  })
  it("blocking 만 반환 (warn 섞이지 않음)", () => {
    const details = listBlockingDetails({
      duplicate_open: 2,
      no_business_day: 1,
      tag_mismatch: 5,
      recent_checkout_block: 3,
    })
    expect(details.map((d) => d.type).sort()).toEqual(
      ["duplicate_open", "no_business_day"].sort(),
    )
  })
  it("warn 만 반환", () => {
    const details = listWarningDetails({
      duplicate_open: 2,
      no_business_day: 1,
      tag_mismatch: 5,
      recent_checkout_block: 3,
    })
    expect(details.map((d) => d.type).sort()).toEqual(
      ["recent_checkout_block", "tag_mismatch"].sort(),
    )
  })
  it("label 이 한글로 제공됨", () => {
    const [d] = listBlockingDetails({ ...zero, duplicate_open: 2 })
    expect(d.label).toBe("중복 출근")
    expect(d.count).toBe(2)
  })
})

describe("summarizeAnomalies", () => {
  it("ok → '정상'", () => {
    expect(summarizeAnomalies(zero)).toBe("정상")
  })
  it("blocking 만 → 🚫 차단 접두사", () => {
    expect(summarizeAnomalies({ ...zero, duplicate_open: 2 })).toContain("🚫")
    expect(summarizeAnomalies({ ...zero, duplicate_open: 2 })).toContain("중복 출근 2건")
  })
  it("warn 만 → ⚠ 경고 접두사", () => {
    expect(summarizeAnomalies({ ...zero, tag_mismatch: 3 })).toContain("⚠")
    expect(summarizeAnomalies({ ...zero, tag_mismatch: 3 })).toContain("Tag 미매칭 3건")
  })
})
