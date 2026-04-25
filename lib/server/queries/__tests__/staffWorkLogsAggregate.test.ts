import { describe, it, expect } from "vitest"
import {
  resolveAmountFromParticipants,
  buildManagerMap,
  splitNewVsExisting,
  type ParticipantForResolve,
  type WorkRecordForResolve,
} from "@/lib/server/queries/staff/workLogsAggregate"

/**
 * cross_store_work_records → cross_store_settlement_items aggregate pure
 * helpers.
 *
 * 커버 범위 (본 라운드):
 *   1) participant 매칭 → price_amount 합계 = amount
 *   2) 매칭 0건 → "participant_not_found"
 *   3) 합계 0 이하 → "amount_zero"
 *   4) role != 'hostess' 는 제외
 *   5) hostesses.manager_membership_id 매핑
 *   6) duplicate upsert key 안정성 (existing set 기반 필터링)
 */

const STORE_A = "00000000-0000-0000-0000-00000000000a"
const STORE_B = "00000000-0000-0000-0000-00000000000b"
const SESS = "00000000-0000-0000-0000-0000000000aa"
const H1 = "00000000-0000-0000-0000-0000000000h1"
const H2 = "00000000-0000-0000-0000-0000000000h2"

function rec(over: Partial<WorkRecordForResolve> = {}): WorkRecordForResolve {
  return {
    session_id: SESS,
    hostess_membership_id: H1,
    working_store_uuid: STORE_B,
    origin_store_uuid: STORE_A,
    ...over,
  }
}

function p(over: Partial<ParticipantForResolve> = {}): ParticipantForResolve {
  return {
    session_id: SESS,
    membership_id: H1,
    store_uuid: STORE_B,
    origin_store_uuid: STORE_A,
    price_amount: 130_000,
    role: "hostess",
    ...over,
  }
}

// ─── resolveAmountFromParticipants ─────────────────────────────

describe("resolveAmountFromParticipants — participant 기반 금액 산출", () => {
  it("완전 매칭 1건 → amount = price_amount", () => {
    const r = resolveAmountFromParticipants(rec(), [p()])
    expect(r).toEqual({ ok: true, amount: 130_000 })
  })

  it("완전 매칭 다건 → price_amount 합계", () => {
    const r = resolveAmountFromParticipants(rec(), [
      p({ price_amount: 130_000 }),
      p({ price_amount: 70_000 }),
    ])
    expect(r).toEqual({ ok: true, amount: 200_000 })
  })

  it("session_id 불일치 → participant_not_found", () => {
    const r = resolveAmountFromParticipants(rec(), [
      p({ session_id: "00000000-0000-0000-0000-000000000ff0" }),
    ])
    expect(r).toEqual({ ok: false, reason: "participant_not_found" })
  })

  it("hostess_membership_id 불일치 → participant_not_found", () => {
    const r = resolveAmountFromParticipants(rec(), [p({ membership_id: H2 })])
    expect(r).toEqual({ ok: false, reason: "participant_not_found" })
  })

  it("working_store_uuid 불일치 → participant_not_found", () => {
    const r = resolveAmountFromParticipants(rec(), [p({ store_uuid: STORE_A })])
    expect(r).toEqual({ ok: false, reason: "participant_not_found" })
  })

  it("origin_store_uuid 불일치 → participant_not_found", () => {
    const r = resolveAmountFromParticipants(rec(), [p({ origin_store_uuid: STORE_B })])
    expect(r).toEqual({ ok: false, reason: "participant_not_found" })
  })

  it("role != hostess 는 제외 (손님/실장)", () => {
    const r = resolveAmountFromParticipants(rec(), [
      p({ role: "customer", price_amount: 500_000 }),
      p({ role: "manager", price_amount: 300_000 }),
    ])
    expect(r).toEqual({ ok: false, reason: "participant_not_found" })
  })

  it("매칭은 있으나 price_amount 가 0 → amount_zero", () => {
    const r = resolveAmountFromParticipants(rec(), [p({ price_amount: 0 })])
    expect(r).toEqual({ ok: false, reason: "amount_zero" })
  })

  it("매칭은 있으나 price_amount 가 null → amount_zero", () => {
    const r = resolveAmountFromParticipants(rec(), [p({ price_amount: null })])
    expect(r).toEqual({ ok: false, reason: "amount_zero" })
  })

  it("음수 price_amount 는 합산에서 제외 (방어적)", () => {
    const r = resolveAmountFromParticipants(rec(), [
      p({ price_amount: -50_000 }),
      p({ price_amount: 130_000 }),
    ])
    expect(r).toEqual({ ok: true, amount: 130_000 })
  })
})

// ─── buildManagerMap ───────────────────────────────────────────

describe("buildManagerMap — hostesses.manager_membership_id 매핑", () => {
  it("정상 row → map 에 정확히 매핑", () => {
    const m = buildManagerMap([
      { membership_id: H1, manager_membership_id: "mgr-1" },
      { membership_id: H2, manager_membership_id: null },
    ])
    expect(m.get(H1)).toBe("mgr-1")
    expect(m.get(H2)).toBeNull()
  })

  it("없는 hostess 조회 → undefined", () => {
    const m = buildManagerMap([{ membership_id: H1, manager_membership_id: "m1" }])
    expect(m.get("unknown")).toBeUndefined()
  })
})

// ─── splitNewVsExisting ────────────────────────────────────────

describe("splitNewVsExisting — duplicate upsert key 분리", () => {
  it("existing set 에 포함된 record_id 는 alreadyLinked 로 분리", () => {
    const candidates = [
      { record_id: "r1", amount: 100 },
      { record_id: "r2", amount: 200 },
      { record_id: "r3", amount: 300 },
    ]
    const existing = new Set<string>(["r2"])
    const { toInsert, alreadyLinked } = splitNewVsExisting(candidates, existing)
    expect(toInsert.map((c) => c.record_id)).toEqual(["r1", "r3"])
    expect(alreadyLinked.map((c) => c.record_id)).toEqual(["r2"])
  })

  it("existing set 비어있으면 전부 toInsert", () => {
    const candidates = [{ record_id: "r1", amount: 100 }]
    const { toInsert, alreadyLinked } = splitNewVsExisting(candidates, new Set())
    expect(toInsert).toHaveLength(1)
    expect(alreadyLinked).toHaveLength(0)
  })

  it("candidates 비어있으면 전부 빈 배열", () => {
    const { toInsert, alreadyLinked } = splitNewVsExisting(
      [] as Array<{ record_id: string }>,
      new Set(["r1"]),
    )
    expect(toInsert).toEqual([])
    expect(alreadyLinked).toEqual([])
  })
})
