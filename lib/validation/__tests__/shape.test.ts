/**
 * 런타임 shape validator 테스트. 2026-04-25: API body 보호 헬퍼 회귀 방지.
 */

import { describe, it, expect } from "vitest"
import {
  isShape,
  isFiniteNumber,
  isString,
  isNonEmptyString,
  isBoolean,
  isUuid,
  isPositiveFiniteNumber,
  isNonNegativeFiniteNumber,
  isIntInRange,
  isOneOf,
  optional,
} from "../shape"

describe("primitive checks", () => {
  it("isFiniteNumber", () => {
    expect(isFiniteNumber(1)).toBe(true)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-1)).toBe(true)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber("1")).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
  })

  it("isString / isNonEmptyString", () => {
    expect(isString("")).toBe(true)
    expect(isString("a")).toBe(true)
    expect(isString(null)).toBe(false)
    expect(isNonEmptyString("")).toBe(false)
    expect(isNonEmptyString("  ")).toBe(false)
    expect(isNonEmptyString("a")).toBe(true)
  })

  it("isBoolean", () => {
    expect(isBoolean(true)).toBe(true)
    expect(isBoolean(false)).toBe(true)
    expect(isBoolean(0)).toBe(false)
    expect(isBoolean("false")).toBe(false)
  })

  it("isUuid", () => {
    expect(isUuid("6dad666f-4693-47d9-b709-460692528f1e")).toBe(true)
    expect(isUuid("not-a-uuid")).toBe(false)
    expect(isUuid("")).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  it("isPositiveFiniteNumber", () => {
    expect(isPositiveFiniteNumber(1)).toBe(true)
    expect(isPositiveFiniteNumber(0)).toBe(false)
    expect(isPositiveFiniteNumber(-1)).toBe(false)
    expect(isPositiveFiniteNumber(NaN)).toBe(false)
  })

  it("isNonNegativeFiniteNumber", () => {
    expect(isNonNegativeFiniteNumber(0)).toBe(true)
    expect(isNonNegativeFiniteNumber(-0.1)).toBe(false)
  })

  it("isIntInRange", () => {
    const r = isIntInRange(1, 5)
    expect(r(1)).toBe(true)
    expect(r(5)).toBe(true)
    expect(r(3)).toBe(true)
    expect(r(0)).toBe(false)
    expect(r(6)).toBe(false)
    expect(r(2.5)).toBe(false)
  })

  it("isOneOf", () => {
    const r = isOneOf(["a", "b", "c"] as const)
    expect(r("a")).toBe(true)
    expect(r("d")).toBe(false)
    expect(r(1)).toBe(false)
  })

  it("optional", () => {
    const r = optional(isFiniteNumber)
    expect(r(undefined)).toBe(true)
    expect(r(null)).toBe(true)
    expect(r(0)).toBe(true)
    expect(r("x")).toBe(false)
  })
})

describe("isShape", () => {
  const schema = {
    id: isUuid,
    amount: isPositiveFiniteNumber,
    name: isNonEmptyString,
    memo: optional(isString),
  }

  it("정상 body 통과", () => {
    const r = isShape({
      id: "6dad666f-4693-47d9-b709-460692528f1e",
      amount: 100,
      name: "홍길동",
      memo: null,
    }, schema)
    expect(r.ok).toBe(true)
  })

  it("필수 필드 빠지면 실패 + field 이름 명시", () => {
    const r = isShape({
      id: "6dad666f-4693-47d9-b709-460692528f1e",
      amount: 100,
    }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("name")
  })

  it("타입 잘못되면 실패", () => {
    const r = isShape({
      id: "not-uuid",
      amount: 100,
      name: "a",
    }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("id")
  })

  it("optional 필드는 undefined 허용", () => {
    const r = isShape({
      id: "6dad666f-4693-47d9-b709-460692528f1e",
      amount: 100,
      name: "홍길동",
    }, schema)
    expect(r.ok).toBe(true)
  })

  it("배열/null body 거부", () => {
    const r1 = isShape([1, 2, 3], schema)
    expect(r1.ok).toBe(false)
    const r2 = isShape(null, schema)
    expect(r2.ok).toBe(false)
  })

  it("NaN amount 거부", () => {
    const r = isShape({
      id: "6dad666f-4693-47d9-b709-460692528f1e",
      amount: NaN,
      name: "a",
    }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("amount")
  })
})
