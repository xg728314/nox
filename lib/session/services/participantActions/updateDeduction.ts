import { NextResponse } from "next/server"

/**
 * Action: manager_deduction update — recalculate hostess payout.
 */
export function updateDeduction(
  deduction: number,
  participant: { price_amount: number }
): { updatePayload: Record<string, number | string | boolean>; actionLabel: string } | { error: NextResponse } {
  // R-deduction-range (2026-06-26): 실장 재량으로 0~10만원 범위 허용 (재량 입력 지원).
  //   CLAUDE.md: "실장수익: 0/5천/1만원 중 재량 선택" — 권장 단계지만 강제 아님.
  //   EditParticipantSheet 의 직접 입력 모드도 동일 범위.
  const d = Math.floor(Number(deduction))
  if (!Number.isFinite(d) || d < 0 || d > 100000) {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "manager_deduction must be 0~100000." },
        { status: 400 }
      ),
    }
  }
  const hostess_payout = Math.max(0, participant.price_amount - d)
  deduction = d
  return {
    updatePayload: {
      manager_payout_amount: deduction,
      hostess_payout_amount: hostess_payout,
    },
    actionLabel: "deduction_updated",
  }
}
