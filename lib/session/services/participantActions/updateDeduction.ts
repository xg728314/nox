import { NextResponse } from "next/server"

/**
 * Action: manager_deduction update — recalculate hostess payout.
 */
export function updateDeduction(
  deduction: number,
  participant: { price_amount: number }
): { updatePayload: Record<string, number | string | boolean>; actionLabel: string } | { error: NextResponse } {
  const ALLOWED = [0, 5000, 10000]
  if (!ALLOWED.includes(deduction)) {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "manager_deduction must be 0, 5000, or 10000." },
        { status: 400 }
      ),
    }
  }
  const hostess_payout = Math.max(0, participant.price_amount - deduction)
  return {
    updatePayload: {
      manager_payout_amount: deduction,
      hostess_payout_amount: hostess_payout,
    },
    actionLabel: "deduction_updated",
  }
}
