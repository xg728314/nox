import { describe, it, expect } from "vitest"
import {
  resolveAmount,
  CATEGORY_MAP,
  WORK_TYPE_TIME_TYPES,
} from "@/lib/server/queries/staffWorkLogsAggregate"

/**
 * resolveAmount — Phase 4 aggregate pricing + hint validation.
 *
 * Policy under test:
 *   - amount SSOT = store_service_types DB (priceMap). hint is validation only.
 *   - shirt + cha3 = 30_000 (seed), shirt + half_cha3 = 반티+차3 합산
 *   - category='etc' 은 매핑 없음 → skip
 *   - hint 0/NaN/음수 → "무시" 로 처리 (DB 단가 그대로 진행)
 *   - hint > 0 이고 sum ≠ hint → skip (DB 단가 덮어쓰기 금지)
 */

function priceMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries)
}

const P_SHIRT_CHA3 = priceMap([
  ["셔츠__기본", 140000],
  ["셔츠__반티", 70000],
  ["셔츠__차3", 30000],
])

const P_PUBLIC_FULL = priceMap([
  ["퍼블릭__기본", 130000],
  ["퍼블릭__반티", 70000],
  ["퍼블릭__차3", 30000],
])

describe("CATEGORY_MAP / WORK_TYPE_TIME_TYPES const snapshot", () => {
  it("maps public/shirt/hyper to Korean service_type values", () => {
    expect(CATEGORY_MAP.public).toBe("퍼블릭")
    expect(CATEGORY_MAP.shirt).toBe("셔츠")
    expect(CATEGORY_MAP.hyper).toBe("하퍼")
  })

  it("does NOT map 'etc' (intentional skip)", () => {
    expect(CATEGORY_MAP.etc).toBeUndefined()
  })

  it("work_type full → 기본, half → 반티, cha3 → 차3", () => {
    expect(WORK_TYPE_TIME_TYPES.full).toEqual(["기본"])
    expect(WORK_TYPE_TIME_TYPES.half).toEqual(["반티"])
    expect(WORK_TYPE_TIME_TYPES.cha3).toEqual(["차3"])
  })

  it("half_cha3 sums 반티 + 차3", () => {
    expect(WORK_TYPE_TIME_TYPES.half_cha3).toEqual(["반티", "차3"])
  })
})

describe("resolveAmount — happy paths (DB SSOT)", () => {
  it("shirt + cha3 → 30000 (no hint)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: null },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 30000 })
  })

  it("shirt + half_cha3 → 100000 (70000 + 30000)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "half_cha3", external_amount_hint: null },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 100000 })
  })

  it("public + full → 130000", () => {
    const r = resolveAmount(
      { category: "public", work_type: "full", external_amount_hint: null },
      P_PUBLIC_FULL,
    )
    expect(r).toEqual({ ok: true, amount: 130000 })
  })
})

describe("resolveAmount — hint validation (검증값 정책)", () => {
  it("hint matches DB sum → pass", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: 30000 },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 30000 })
  })

  it("hint mismatch → skip with reason including both values", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: 40000 },
      P_SHIRT_CHA3,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/40000/)
      expect(r.reason).toMatch(/30000/)
      expect(r.reason).toMatch(/불일치/)
    }
  })

  it("hint = 0 → treated as 'no hint' (DB 단가로 진행)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: 0 },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 30000 })
  })

  it("hint < 0 → treated as 'no hint' (DB 단가로 진행)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: -1 },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 30000 })
  })

  it("hint NaN → treated as 'no hint' (DB 단가로 진행)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: NaN },
      P_SHIRT_CHA3,
    )
    expect(r).toEqual({ ok: true, amount: 30000 })
  })
})

describe("resolveAmount — skip paths (0원 편입 방지)", () => {
  it("category='etc' → skip (매핑 없음)", () => {
    const r = resolveAmount(
      { category: "etc", work_type: "full", external_amount_hint: 100000 },
      P_SHIRT_CHA3,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/category=etc/)
  })

  it("work_type='unknown' → skip", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "weird", external_amount_hint: null },
      P_SHIRT_CHA3,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/work_type=weird/)
  })

  it("priceMap missing entry → skip", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: null },
      priceMap([["셔츠__기본", 140000]]), // 차3 없음
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/미등록/)
  })

  it("priceMap has 0 price → skip (0원 편입 금지)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: null },
      priceMap([["셔츠__차3", 0]]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/미등록\/0원/)
  })

  it("priceMap has negative price → skip", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: null },
      priceMap([["셔츠__차3", -500]]),
    )
    expect(r.ok).toBe(false)
  })

  it("half_cha3: one part missing → skip (부분 합산 금지)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "half_cha3", external_amount_hint: null },
      priceMap([["셔츠__반티", 70000]]), // 차3 부재
    )
    expect(r.ok).toBe(false)
  })
})

describe("resolveAmount — regression: hint does not override DB", () => {
  it("hint=99999 while DB=30000 → MUST skip (prior bug: hint 덮어쓰기)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "cha3", external_amount_hint: 99999 },
      P_SHIRT_CHA3,
    )
    expect(r.ok).toBe(false)
    if (r.ok) {
      // eslint-disable-next-line no-console
      console.error("REGRESSION: hint overrode DB price!", r)
    }
  })

  it("absent hint + valid DB → amount == DB sum exactly (no inflation)", () => {
    const r = resolveAmount(
      { category: "shirt", work_type: "half_cha3", external_amount_hint: null },
      P_SHIRT_CHA3,
    )
    if (r.ok) expect(r.amount).toBe(70000 + 30000)
  })
})
