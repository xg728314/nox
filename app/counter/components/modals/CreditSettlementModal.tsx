"use client"

import type { CreditRow } from "../../hooks/useCreditSettlementFlow"
import type { BankAccount } from "../../types"

/**
 * CreditSettlementModal — credit ↔ account 연결 UI.
 *
 * Pure UI. Displays pending credits, lets the user pick one, shows the
 * currently selected account from useAccountSelectionFlow (passed in as a
 * prop), and forwards confirm/cancel events to the hook.
 *
 * Does NOT own:
 *   - credit fetch, credit create, credit PATCH
 *   - account fetch, account selection state
 *   - any API call
 */

type Props = {
  open: boolean
  loading: boolean
  error: string
  submitting: boolean
  credits: CreditRow[]
  selectedCreditId: string | null
  linkedAccount: BankAccount | null
  onSelectCredit: (id: string) => void
  onClose: () => void
  onCollect: () => void
  onCancel: () => void
  onOpenAccountPicker: () => void
}

function fmtWon(v: number): string {
  return (v || 0).toLocaleString() + "원"
}

export default function CreditSettlementModal({
  open, loading, error, submitting, credits, selectedCreditId, linkedAccount,
  onSelectCredit, onClose, onCollect, onCancel, onOpenAccountPicker,
}: Props) {
  if (!open) return null

  const selected = credits.find(c => c.id === selectedCreditId) ?? null
  const canCollect = !!selected && !!linkedAccount && !submitting
  const canCancel = !!selected && !submitting

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[440px] max-w-[94vw] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">외상 수금 연결</div>
        <div className="text-[11px] text-slate-500 mb-3">수금할 외상 건을 선택하고 계좌를 연결하세요.</div>

        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
        )}

        {/* Pending credit list */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 mb-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded">
          {loading && (
            <div className="py-6 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
          )}

          {!loading && credits.length === 0 && (
            <div className="py-6 text-center text-slate-500 text-xs">수금 대기 외상이 없습니다.</div>
          )}

          {!loading && credits.map(c => {
            const picked = c.id === selectedCreditId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectCredit(c.id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  picked
                    ? "bg-amber-500/15 border-amber-500/40 text-white"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.customer_name}</span>
                  <span className="text-sm font-bold text-amber-300">{fmtWon(c.amount)}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {c.room_name ?? "—"} · {new Date(c.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                </div>
                {c.memo && (
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{c.memo}</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Linked account section */}
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">수금 계좌</span>
            <button
              type="button"
              onClick={onOpenAccountPicker}
              className="text-[10px] text-cyan-300 hover:text-cyan-200"
            >{linkedAccount ? "변경" : "선택"}</button>
          </div>
          {linkedAccount ? (
            <div className="mt-1">
              <div className="text-sm text-white font-medium">{linkedAccount.bank_name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">예금주 {linkedAccount.holder_name}</div>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-500">계좌가 선택되지 않았습니다.</div>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-50"
          >닫기</button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!canCancel}
            className="py-2 rounded-xl text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 disabled:opacity-40"
          >취소 처리</button>
          <button
            type="button"
            onClick={onCollect}
            disabled={!canCollect}
            className="py-2 rounded-xl text-xs font-semibold text-white bg-emerald-500/80 hover:bg-emerald-500 disabled:opacity-40"
          >{submitting ? "처리 중..." : "수금 완료"}</button>
        </div>
      </div>
    </div>
  )
}
