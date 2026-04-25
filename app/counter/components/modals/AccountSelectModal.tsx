"use client"

import { useState } from "react"
import type { BankAccount } from "../../types"

/**
 * AccountSelectModal — UI for selecting account mode + picking an account.
 *
 * Account modes:
 * - manager: personal manager account
 * - shared: same-store shared accounts (is_shared=true)
 * - manual: manual input (bank_name + account_number + holder_name)
 * - hidden: no account output
 */

type Props = {
  open: boolean
  loading: boolean
  accounts: BankAccount[]
  sharedAccounts: BankAccount[]
  pickedId: string | null
  mode: "manager" | "shared" | "manual" | "hidden"
  manualInput: { bank_name: string; account_number: string; holder_name: string }
  onPick: (id: string) => void
  onSetMode: (mode: "manager" | "shared" | "manual" | "hidden") => void
  onSetManualInput: (input: { bank_name: string; account_number: string; holder_name: string }) => void
  onClose: () => void
  onConfirm: () => void
}

function maskAccountNumber(n: string): string {
  const s = (n ?? "").replace(/\s/g, "")
  if (s.length <= 6) return s
  return `${s.slice(0, 2)}****${s.slice(-4)}`
}

const MODE_TABS: { value: Props["mode"]; label: string }[] = [
  { value: "manager", label: "내 계좌" },
  { value: "shared", label: "공용 계좌" },
  { value: "manual", label: "직접 입력" },
  { value: "hidden", label: "숨김" },
]

export default function AccountSelectModal({
  open, loading, accounts, sharedAccounts, pickedId, mode, manualInput,
  onPick, onSetMode, onSetManualInput, onClose, onConfirm,
}: Props) {
  if (!open) return null

  const activeList = mode === "manager" ? accounts : mode === "shared" ? sharedAccounts : []
  const canConfirm =
    mode === "hidden" ||
    mode === "manual" && manualInput.bank_name.trim() && manualInput.account_number.trim() ||
    (mode === "manager" || mode === "shared") && !!pickedId && activeList.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[440px] max-w-[92vw] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">계좌 선택</div>
        <div className="text-[11px] text-slate-500 mb-3">결제받을 계좌를 선택하세요.</div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-3">
          {MODE_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => onSetMode(t.value)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                mode === t.value
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "bg-white/5 text-slate-400 border border-white/[0.06] hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-[120px] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded">

          {/* Manager / Shared mode: account list */}
          {(mode === "manager" || mode === "shared") && (
            <>
              {loading && (
                <div className="py-6 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
              )}
              {!loading && activeList.length === 0 && (
                <div className="py-6 text-center text-slate-500 text-xs">
                  {mode === "manager" ? "등록된 계좌가 없습니다." : "공용 계좌가 없습니다."}
                  <div className="mt-1 text-[10px] text-slate-600">
                    {mode === "manager" ? "내정보 → 계좌 관리에서 등록하세요." : "매장 설정에서 공용 계좌를 등록하세요."}
                  </div>
                </div>
              )}
              {!loading && activeList.map(a => {
                const picked = a.id === pickedId
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onPick(a.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      picked
                        ? "bg-cyan-500/15 border-cyan-500/40 text-white"
                        : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{a.bank_name}</span>
                      {a.is_default && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">기본</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{maskAccountNumber(a.account_number)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">예금주 {a.holder_name}</div>
                  </button>
                )
              })}
            </>
          )}

          {/* Manual input mode */}
          {mode === "manual" && (
            <div className="space-y-2 py-2">
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">은행명</label>
                <input
                  value={manualInput.bank_name}
                  onChange={e => onSetManualInput({ ...manualInput, bank_name: e.target.value })}
                  placeholder="예: 국민은행"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">계좌번호</label>
                <input
                  value={manualInput.account_number}
                  onChange={e => onSetManualInput({ ...manualInput, account_number: e.target.value })}
                  placeholder="계좌번호 입력"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">예금주</label>
                <input
                  value={manualInput.holder_name}
                  onChange={e => onSetManualInput({ ...manualInput, holder_name: e.target.value })}
                  placeholder="예금주 이름"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
            </div>
          )}

          {/* Hidden mode */}
          {mode === "hidden" && (
            <div className="py-8 text-center">
              <div className="text-[11px] text-slate-400">계좌 정보를 표시하지 않습니다.</div>
              <div className="text-[10px] text-slate-600 mt-1">영수증/정산서에 계좌가 노출되지 않습니다.</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20"
          >취소</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="py-2 rounded-xl text-xs font-semibold text-white bg-cyan-500/80 hover:bg-cyan-500 disabled:opacity-40"
          >{mode === "hidden" ? "숨김 확인" : "확인"}</button>
        </div>
      </div>
    </div>
  )
}
