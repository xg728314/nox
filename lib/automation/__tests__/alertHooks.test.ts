import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  emitAutomationAlert,
  __resetAlertDedup,
} from "@/lib/automation/alertHooks"

// Telegram 채널은 env 없으면 env_missing 으로 실패 (silent 아님).
// 이 테스트는 네트워크 호출 자체를 mock 해 dedup 동작만 고립 검증한다.
vi.mock("@/lib/automation/channels/telegram", () => ({
  sendTelegram: vi.fn(async () => ({ ok: true, message_id: 1 })),
}))

import { sendTelegram } from "@/lib/automation/channels/telegram"

describe("emitAutomationAlert — dedup behavior (ROUND-ALERT-1)", () => {
  beforeEach(() => {
    __resetAlertDedup()
    ;(sendTelegram as unknown as ReturnType<typeof vi.fn>).mockClear()
    ;(sendTelegram as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({ ok: true, message_id: 1 }),
    )
  })

  it("첫 emit 은 실제 발송 (ok, deduped=false)", async () => {
    const r = await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1", "m2"],
      message: "test",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.deduped).toBe(false)
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })

  it("같은 key 재호출은 dedup 으로 skip (ok, deduped=true)", async () => {
    await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1", "m2"],
      message: "first",
    })
    const r2 = await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1", "m2"],
      message: "second",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.deduped).toBe(true)
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })

  it("entity_ids 순서가 달라도 같은 집합이면 dedup 성립", async () => {
    await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m2", "m1"],
      message: "a",
    })
    const r2 = await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1", "m2"],
      message: "b",
    })
    if (r2.ok) expect(r2.deduped).toBe(true)
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })

  it("다른 매장이면 별도 dedup key → 각각 발송", async () => {
    await emitAutomationAlert({
      type: "duplicate_open",
      store_uuid: "S1",
      entity_ids: ["m1"],
      message: "x",
    })
    await emitAutomationAlert({
      type: "duplicate_open",
      store_uuid: "S2",
      entity_ids: ["m1"],
      message: "y",
    })
    expect(sendTelegram).toHaveBeenCalledTimes(2)
  })

  it("다른 type 이면 별도 dedup key", async () => {
    await emitAutomationAlert({
      type: "duplicate_open",
      store_uuid: "S",
      entity_ids: ["m1"],
      message: "a",
    })
    await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1"],
      message: "b",
    })
    expect(sendTelegram).toHaveBeenCalledTimes(2)
  })

  it("entity_ids 가 다르면 (새 사람 등장) 새 알림 발송", async () => {
    await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1"],
      message: "a",
    })
    await emitAutomationAlert({
      type: "tag_mismatch",
      store_uuid: "S",
      entity_ids: ["m1", "m2"], // m2 추가 → 다른 key
      message: "b",
    })
    expect(sendTelegram).toHaveBeenCalledTimes(2)
  })

  it("발송 실패 시 dedup 에 기록되지 않아 다음 호출에서 재시도", async () => {
    ;(sendTelegram as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => ({ ok: false, reason: "network", detail: "fail" }),
    )
    const r1 = await emitAutomationAlert({
      type: "no_business_day",
      store_uuid: "S",
      message: "1st",
    })
    expect(r1.ok).toBe(false)

    // 다음 호출은 dedup skip 되지 않고 실제 발송
    const r2 = await emitAutomationAlert({
      type: "no_business_day",
      store_uuid: "S",
      message: "2nd",
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.deduped).toBe(false)
    expect(sendTelegram).toHaveBeenCalledTimes(2)
  })

  it("no_business_day 는 entity_ids 생략해도 (type, store) 기준 dedup 성립", async () => {
    await emitAutomationAlert({
      type: "no_business_day",
      store_uuid: "S",
      message: "a",
    })
    const r2 = await emitAutomationAlert({
      type: "no_business_day",
      store_uuid: "S",
      message: "b",
    })
    if (r2.ok) expect(r2.deduped).toBe(true)
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })
})
