"use client"

import type { MyAccount } from "../hooks/useMyAccounts"

/**
 * MyAccountList — renders the current user's settlement account list.
 * Pure UI. Delegates all actions upward.
 *
 * STEP-010: extended with edit / delete / set-default callbacks. Legacy
 * call sites that only pass `onAddClick` still work because the action
 * callbacks are optional.
 */

type Props = {
  accounts: MyAccount[]
  loading: boolean
  error: string
  onAddClick: () => void
  onEdit?: (account: MyAccount) => void
  onRemove?: (id: string) => void
  onSetDefault?: (id: string) => void
}

function maskAccountNumber(n: string | null): string {
  const s = (n ?? "").replace(/\s/g, "")
  if (s.length <= 6) return s
  return `${s.slice(0, 2)}****${s.slice(-4)}`
}

export default function MyAccountList({
  accounts, loading, error, onAddClick, onEdit, onRemove, onSetDefault,
}: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">내 계좌</div>
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

      {!loading && accounts.length === 0 && !error && (
        <div className="py-4 text-center text-slate-500 text-xs">등록된 계좌가 없습니다.</div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="space-y-1.5">
          {accounts.map(a => (
            <div key={a.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white font-medium">{a.bank_name ?? "-"}</span>
                  {a.is_default && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">기본</span>
                  )}
                  {!a.is_active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400">비활성</span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {onSetDefault && !a.is_default && (
                    <button
                      type="button"
                      onClick={() => onSetDefault(a.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-emerald-300 hover:text-emerald-200"
                    >기본설정</button>
                  )}
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(a)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-cyan-300 hover:text-cyan-200"
                    >수정</button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(a.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:text-red-300"
                    >삭제</button>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{maskAccountNumber(a.account_number)}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                예금주 {a.account_holder_name ?? a.holder_name ?? "-"}
                {a.account_type ? ` · ${a.account_type}` : ""}
              </div>
              {a.note && (
                <div className="text-[10px] text-slate-500 mt-0.5 italic">{a.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
