/**
 * Action: banti — set price_amount to banti_amount.
 */
export type BantiInput = {
  banti_amount: number
  manager_payout_amount: number
}

export function applyBanti(participant: BantiInput): {
  updatePayload: Record<string, number | string | boolean>
  actionLabel: string
} {
  const newPrice = participant.banti_amount
  const newHostess = Math.max(0, newPrice - participant.manager_payout_amount)
  return {
    updatePayload: {
      price_amount: newPrice,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "banti_applied",
  }
}
