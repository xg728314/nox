import { describe, it, expect } from "vitest"
import {
  lookupSymbol,
  parseHanjaCount,
  matchKnownStore,
  DEFAULT_SYMBOL_DICTIONARY,
  DEFAULT_KNOWN_STORES,
} from "../symbols"

describe("lookupSymbol", () => {
  it("기본 사전 매핑", () => {
    expect(lookupSymbol("★")).toEqual({ service_type: "셔츠" })
    expect(lookupSymbol("(완)")).toEqual({ time_tier: "완티" })
    expect(lookupSymbol("(빵3)")).toEqual({ time_tier: "반차3" })
  })

  it("괄호 없는 표기도 매핑", () => {
    expect(lookupSymbol("완")).toEqual({ time_tier: "완티" })
    expect(lookupSymbol("반")).toEqual({ time_tier: "반티" })
  })

  it("매장 dict 가 default 를 override", () => {
    const storeDict = { "★": { service_type: "퍼블릭" as const } }
    expect(lookupSymbol("★", storeDict)).toEqual({ service_type: "퍼블릭" })
    // override 안 한 항목은 default
    expect(lookupSymbol("(완)", storeDict)).toEqual({ time_tier: "완티" })
  })

  it("(잔) 은 needs_review", () => {
    const r = lookupSymbol("(잔)")
    expect(r?.needs_review).toBe(true)
  })

  it("모르는 심볼은 null", () => {
    expect(lookupSymbol("(@@@)")).toBeNull()
  })

  it("공백 trim", () => {
    expect(lookupSymbol("  ★  ")).toEqual({ service_type: "셔츠" })
  })
})

describe("parseHanjaCount", () => {
  it("一/二/三", () => {
    expect(parseHanjaCount("一")).toBe(1)
    expect(parseHanjaCount("二")).toBe(2)
    expect(parseHanjaCount("三")).toBe(3)
  })

  it("ㅡ/ㅜ (한글로 흘려쓴 형태)", () => {
    expect(parseHanjaCount("ㅡ")).toBe(1)
    expect(parseHanjaCount("ㅜ")).toBe(2)
  })

  it("T 반복 = 카운트", () => {
    expect(parseHanjaCount("T")).toBe(1)
    expect(parseHanjaCount("TT")).toBe(2)
    expect(parseHanjaCount("TTT")).toBe(3)
  })

  it("관계없는 문자는 null", () => {
    expect(parseHanjaCount("X")).toBeNull()
    expect(parseHanjaCount("12")).toBeNull()
  })
})

describe("matchKnownStore", () => {
  it("화이트리스트 정확 매칭", () => {
    expect(matchKnownStore("토끼")).toBe("토끼")
    expect(matchKnownStore("황진이")).toBe("황진이")
    expect(matchKnownStore("라이브")).toBe("라이브")
  })

  it("미등록 매장은 null", () => {
    expect(matchKnownStore("이상한매장")).toBeNull()
  })

  it("공백 trim 후 비교", () => {
    expect(matchKnownStore("  토끼  ")).toBe("토끼")
  })

  it("default 화이트리스트 검증", () => {
    expect(DEFAULT_KNOWN_STORES.length).toBeGreaterThan(0)
    expect(DEFAULT_KNOWN_STORES.includes("마블")).toBe(true)
  })
})

describe("DEFAULT_SYMBOL_DICTIONARY", () => {
  it("핵심 심볼 모두 포함", () => {
    expect(DEFAULT_SYMBOL_DICTIONARY["★"]).toBeDefined()
    expect(DEFAULT_SYMBOL_DICTIONARY["S"]).toBeDefined()
    expect(DEFAULT_SYMBOL_DICTIONARY["(완)"]).toBeDefined()
    expect(DEFAULT_SYMBOL_DICTIONARY["(반차3)"]).toBeDefined()
    expect(DEFAULT_SYMBOL_DICTIONARY["(빵3)"]).toBeDefined()
  })
})
