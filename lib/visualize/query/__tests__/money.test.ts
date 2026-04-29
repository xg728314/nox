/**
 * Visualize layer — pure-helper unit tests.
 *
 * The full `queryMoneyFlow` integration requires a live DB and is covered
 * by E2E. This file pins the contracts that don't need DB access:
 *   - PII mask helpers
 *   - denylist patterns
 *   - MONEY_NODE_IDS uniqueness (sankey layout depends on it)
 */

import { describe, it, expect } from "vitest"
import { MONEY_NODE_IDS } from "../../shapes"
import { isSensitiveColumn, isBlockedTable } from "../../denylist"
import { maskPhone, maskName, maskEmail, maskAccount, maskRow } from "../../pii"

describe("MONEY_NODE_IDS", () => {
  it("all node IDs are unique strings", () => {
    const values = Object.values(MONEY_NODE_IDS)
    const set = new Set(values)
    expect(set.size).toBe(values.length)
    for (const v of values) {
      expect(typeof v).toBe("string")
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it("includes the four expected groups (source/aggregate/allocation/sink/reversal)", () => {
    // Soft check: at least one node per concept.
    expect(MONEY_NODE_IDS.SRC_ORDERS).toBeTruthy()
    expect(MONEY_NODE_IDS.RECEIPTS_FINALIZED).toBeTruthy()
    expect(MONEY_NODE_IDS.ALLOC_MANAGER).toBeTruthy()
    expect(MONEY_NODE_IDS.PAYOUT_APPROVED).toBeTruthy()
    expect(MONEY_NODE_IDS.PAYOUT_REVERSED).toBeTruthy()
  })
})

describe("denylist", () => {
  it("matches sensitive column names", () => {
    expect(isSensitiveColumn("phone")).toBe(true)
    expect(isSensitiveColumn("customer_phone")).toBe(true)
    expect(isSensitiveColumn("gateway_secret")).toBe(true)
    expect(isSensitiveColumn("password_hash")).toBe(true)
    expect(isSensitiveColumn("access_token")).toBe(true)
    expect(isSensitiveColumn("email_address")).toBe(true)
    expect(isSensitiveColumn("account_number")).toBe(true)
    expect(isSensitiveColumn("must_change_password")).toBe(true)
  })

  it("does not match safe column names", () => {
    expect(isSensitiveColumn("amount")).toBe(false)
    expect(isSensitiveColumn("store_uuid")).toBe(false)
    expect(isSensitiveColumn("created_at")).toBe(false)
    expect(isSensitiveColumn("session_id")).toBe(false)
    expect(isSensitiveColumn("status")).toBe(false)
  })

  it("blocks known sensitive tables", () => {
    expect(isBlockedTable("auth_rate_limits")).toBe(true)
    expect(isBlockedTable("ble_gateways")).toBe(true)
    expect(isBlockedTable("stores")).toBe(false)
    expect(isBlockedTable("receipts")).toBe(false)
  })
})

describe("PII masking", () => {
  it("maskPhone keeps last 4 digits", () => {
    expect(maskPhone("010-1234-5678")).toBe("***-****-5678")
    expect(maskPhone("01099991111")).toBe("*******1111")
    expect(maskPhone("")).toBe("")
    expect(maskPhone(null)).toBe("")
    expect(maskPhone(undefined)).toBe("")
  })

  it("maskPhone fully masks short inputs", () => {
    expect(maskPhone("1234")).toBe("****")
    expect(maskPhone("123")).toBe("***")
  })

  it("maskName keeps first character", () => {
    expect(maskName("홍길동")).toBe("홍**")
    expect(maskName("김")).toBe("*")
    expect(maskName("")).toBe("")
    expect(maskName(null)).toBe("")
  })

  it("maskEmail keeps first char of local + domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a****@example.com")
    expect(maskEmail("x@y")).toBe("*@y")
    expect(maskEmail("")).toBe("")
  })

  it("maskAccount keeps last 3 digits", () => {
    expect(maskAccount("1234567890")).toBe("*******890")
    expect(maskAccount("12")).toBe("**")
    expect(maskAccount("")).toBe("")
  })

  it("maskRow masks fields matching the denylist", () => {
    const row = {
      name: "Alice",
      phone: "010-1234-5678",
      email: "a@b.com",
      account_number: "1234567890",
      amount: 50000,
      status: "active",
    }
    const masked = maskRow(row)
    expect(masked.name).toBe("Alice") // 'name' is not in the regex
    expect(masked.phone).toBe("***-****-5678")
    expect(masked.email).toBe("*@b.com")
    expect(masked.amount).toBe(50000) // not sensitive
    expect(masked.status).toBe("active")
    expect(typeof masked.account_number).toBe("string")
    expect(masked.account_number).not.toBe("1234567890")
  })
})
