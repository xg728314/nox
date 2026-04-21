import { NextResponse } from "next/server"

/**
 * Action: toggle_waiter_tip — flip waiter_tip_received and recalculate amount.
 */
export function toggleWaiterTip(
  participant: { waiter_tip_received: boolean; waiter_tip_amount: number },
  bodyAmount?: number | null
): { updatePayload: Record<string, number | string | boolean>; actionLabel: string } | { error: NextResponse } {
  const nextReceived = !participant.waiter_tip_received
  const nextAmount = nextReceived
    ? (bodyAmount !== undefined && bodyAmount !== null
        ? bodyAmount
        : (participant.waiter_tip_amount ?? 0))
    : 0
  if (typeof nextAmount !== "number" || nextAmount < 0) {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "waiter_tip_amount must be non-negative." },
        { status: 400 }
      ),
    }
  }
  return {
    updatePayload: {
      waiter_tip_received: nextReceived,
      waiter_tip_amount: nextAmount,
    },
    actionLabel: "waiter_tip_toggled",
  }
}
