import { NextResponse } from "next/server"

/**
 * Action: direct time_minutes + price_amount edit.
 */
export function updateTimeOrPrice(
  timeMinutes: number,
  priceAmount: number,
  participant: { manager_payout_amount: number }
): { updatePayload: Record<string, number | string | boolean>; actionLabel: string } | { error: NextResponse } {
  if (typeof timeMinutes !== "number" || typeof priceAmount !== "number") {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "time_minutes and price_amount must be numbers." },
        { status: 400 }
      ),
    }
  }
  if (timeMinutes < 0 || priceAmount < 0) {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "time_minutes and price_amount must be non-negative." },
        { status: 400 }
      ),
    }
  }
  const newHostess = Math.max(0, priceAmount - participant.manager_payout_amount)
  return {
    updatePayload: {
      time_minutes: timeMinutes,
      price_amount: priceAmount,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "time_price_updated",
  }
}
