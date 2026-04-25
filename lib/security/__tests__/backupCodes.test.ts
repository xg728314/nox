/**
 * R25: 백업 코드 회귀 방지.
 *   pure 함수만 테스트 (consume/regenerate 는 supabase mock 필요 — 별도).
 */

import { describe, it, expect } from "vitest"
import {
  generateBackupCodes,
  normalizeBackupCode,
  looksLikeBackupCode,
} from "../backupCodes"

describe("generateBackupCodes", () => {
  it("기본 8개, 평문/해시 length 동일", () => {
    const { plain, hashed } = generateBackupCodes()
    expect(plain).toHaveLength(8)
    expect(hashed).toHaveLength(8)
  })

  it("평문 포맷: XXXX-XXXX-XXXX (12자 + 대시 2개 = 14)", () => {
    const { plain } = generateBackupCodes(3)
    for (const code of plain) {
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(code).toHaveLength(14)
    }
  })

  it("헷갈리는 문자 (0/O/1/I/L) 미포함", () => {
    // 100개 생성해서 한 번도 안 나오는지 확인 — 통계적으로 충분.
    const { plain } = generateBackupCodes(100)
    const joined = plain.join("")
    expect(joined).not.toMatch(/[0OIL1]/)
  })

  it("해시는 64자 hex (sha-256)", () => {
    const { hashed } = generateBackupCodes(2)
    for (const h of hashed) {
      expect(h).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it("매번 다른 코드 (충돌 0)", () => {
    const a = generateBackupCodes(50).plain
    const b = generateBackupCodes(50).plain
    const set = new Set([...a, ...b])
    expect(set.size).toBe(100)
  })
})

describe("normalizeBackupCode", () => {
  it("공백/대시 제거 + 대문자", () => {
    expect(normalizeBackupCode("abcd-efgh-2345")).toBe("ABCDEFGH2345")
    expect(normalizeBackupCode(" ABCD EFGH 2345 ")).toBe("ABCDEFGH2345")
    expect(normalizeBackupCode("abcdefgh2345")).toBe("ABCDEFGH2345")
  })

  it("길이 12 가 아니면 null", () => {
    expect(normalizeBackupCode("ABCD-EFGH")).toBeNull()
    expect(normalizeBackupCode("ABCD-EFGH-23456")).toBeNull()
    expect(normalizeBackupCode("")).toBeNull()
  })

  it("금지 문자 (0,O,I,L,1) 거부", () => {
    expect(normalizeBackupCode("0BCD-EFGH-2345")).toBeNull()
    expect(normalizeBackupCode("ABCD-EFGH-23OL")).toBeNull()
    expect(normalizeBackupCode("ABCD-EFGH-2I45")).toBeNull()
  })

  it("특수문자 거부", () => {
    expect(normalizeBackupCode("ABCD-EFGH-23$%")).toBeNull()
  })
})

describe("looksLikeBackupCode", () => {
  it("TOTP 6자리는 백업코드 아님", () => {
    expect(looksLikeBackupCode("123456")).toBe(false)
    expect(looksLikeBackupCode("000000")).toBe(false)
  })

  it("정상 백업코드는 true", () => {
    const { plain } = generateBackupCodes(1)
    expect(looksLikeBackupCode(plain[0])).toBe(true)
  })

  it("부분 입력은 false", () => {
    expect(looksLikeBackupCode("ABCD-EFGH")).toBe(false)
  })
})
