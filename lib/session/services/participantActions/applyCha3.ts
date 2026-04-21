/**
 * Action: cha3 — add cha3_amount to current price_amount.
 */
export type Cha3Input = {
  price_amount: number
  cha3_amount: number
  manager_payout_amount: number
}

export function applyCha3(participant: Cha3Input): {
  updatePayload: Record<string, number | string | boolean>
  actionLabel: string
} {
  const newPrice = participant.price_amount + participant.cha3_amount
  const newHostess = Math.max(0, newPrice - participant.manager_payout_amount)
  return {
    updatePayload: {
      price_amount: newPrice,
      hostess_payout_amount: newHostess,
    },
    actionLabel: "cha3_applied",
  }
}
