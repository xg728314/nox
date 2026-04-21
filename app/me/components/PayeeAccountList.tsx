"use client"

import type { PayeeAccount } from "../hooks/usePayeeAccounts"

/**
 * PayeeAccountList — store-scoped payee directory, pure UI.
 * Delegates all actions upward to the parent page.
 */

type Props = {
  payees: PayeeAccount[]
  loading: boolean
  error: string
  onAddClick: () => void
  onEdit?: (payee: PayeeAccount) => void
  onRemove?: (id: string) => void
}

function maskAccountNumber(n: string | null): string {
  const s = (n ?? "").replace(/\s/g, "")
  if (s.length <= 6) return s
  return `${s.slice(0, 2)}****${s.slice(-4)}`
}

export default function PayeeAccountList({
  payees, loading, error, onAddClick, onEdit, onRemove,
}: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">지급 대상 계좌</div>
        <button
          type="button"
          onClick={onAddClick}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30"
        >+ 추가</button>
      </div>

      {error && (
        <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
      )}

      {loading && (
        <div className="py-4 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
      )}

      {!loading && payees.length === 0 && !error && (
        <div className="py-4 text-center text-slate-500 text-xs">등록된 지급 대상이 없습니다.</div>
      )}

      {!loading && payees.length > 0 && (
        <div className="space-y-1.5">
          {payees.map(p => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white font-medium truncate">{p.payee_name ?? "-"}</span>
                  {p.role_type && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-slate-300">{p.role_type}</span>
                  )}
                  {!p.is_active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400">비활성</span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(p)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-cyan-300 hover:text-cyan-200"
                    >수정</button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(p.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:text-red-300"
                    >삭제</button>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {p.bank_name ?? "-"} · {maskAccountNumber(p.account_number)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">예금주 {p.account_holder_name ?? "-"}</div>
              {p.note && (
                <div className="text-[10px] text-slate-500 mt-0.5 italic">{p.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
