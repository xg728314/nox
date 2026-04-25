/**
 * lib/format.ts 단위 테스트. 2026-04-25: 숫자/날짜 포맷 헬퍼는 앱 전역에서
 *   쓰이므로 회귀 방지용 고정 케이스.
 */

import { describe, it, expect } from "vitest"
import {
  fmtWon,
  fmtMan,
  fmtNumber,
  fmtPercent,
  fmtDateShort,
  fmtDateISO,
  fmtTimeHM,
  fmtDateTime,
} from "../format"

describe("fmtWon", () => {
  it("양수 정상", () => {
    expect(fmtWon(1234567)).toBe("₩1,234,567")
  })
  it("0 은 ₩0", () => {
    expect(fmtWon(0)).toBe("₩0")
  })
  it("null/undefined → placeholder", () => {
    expect(fmtWon(null)).toBe("−")
    expect(fmtWon(undefined)).toBe("−")
  })
  it("NaN/Infinity → placeholder", () => {
    expect(fmtWon(NaN)).toBe("−")
    expect(fmtWon(Infinity)).toBe("−")
  })
  it("음수 표기", () => {
    expect(fmtWon(-5000)).toBe("₩-5,000")
  })
})

describe("fmtMan", () => {
  it("정확히 만 단위", () => {
    expect(fmtMan(500000)).toBe("50만")
    expect(fmtMan(10000)).toBe("1만")
  })
  it("만 + 나머지", () => {
    expect(fmtMan(523400)).toBe("52만3,400")
    expect(fmtMan(12345)).toBe("1만2,345")
  })
  it("만 미만", () => {
    expect(fmtMan(7000)).toBe("7,000원")
    expect(fmtMan(0)).toBe("0원")
  })
  it("음수 표기", () => {
    expect(fmtMan(-500000)).toBe("-50만")
  })
  it("null → placeholder", () => {
    expect(fmtMan(null)).toBe("−")
  })
})

describe("fmtNumber", () => {
  it("정수", () => expect(fmtNumber(1234567)).toBe("1,234,567"))
  it("null", () => expect(fmtNumber(null)).toBe("−"))
  it("NaN", () => expect(fmtNumber(NaN)).toBe("−"))
})

describe("fmtPercent", () => {
  it("정수 퍼센트", () => expect(fmtPercent(29)).toBe("29%"))
  it("소수점 1자리", () => expect(fmtPercent(29.4, 1)).toBe("29.4%"))
  it("null → placeholder", () => expect(fmtPercent(null)).toBe("−"))
})

describe("fmtDateShort", () => {
  it("ISO 문자열", () => {
    expect(fmtDateShort("2026-04-25T12:00:00Z")).toMatch(/\d+월 \d+일/)
  })
  it("null → placeholder", () => {
    expect(fmtDateShort(null)).toBe("−")
  })
  it("invalid → placeholder", () => {
    expect(fmtDateShort("not a date")).toBe("−")
  })
})

describe("fmtDateISO", () => {
  it("ISO 포맷", () => {
    expect(fmtDateISO("2026-04-25T15:30:00Z")).toBe("2026-04-25")
  })
  it("invalid → placeholder", () => {
    expect(fmtDateISO("")).toBe("−")
  })
})

describe("fmtTimeHM", () => {
  it("시:분", () => {
    const s = fmtTimeHM("2026-04-25T15:30:00Z")
    // 타임존 의존적 — 포맷만 검증
    expect(s).toMatch(/\d{1,2}:\d{2}/)
  })
  it("null → placeholder", () => {
    expect(fmtTimeHM(null)).toBe("−")
  })
})

describe("fmtDateTime", () => {
  it("날짜 + 시간 조합", () => {
    const s = fmtDateTime("2026-04-25T15:30:00Z")
    expect(s).toMatch(/\d+월 \d+일 \d{1,2}:\d{2}/)
  })
  it("Date 객체도 허용", () => {
    const s = fmtDateTime(new Date("2026-04-25T12:00:00Z"))
    expect(s).toMatch(/\d+월 \d+일 \d{1,2}:\d{2}/)
  })
})
