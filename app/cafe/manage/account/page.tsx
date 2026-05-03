"use client"

/**
 * 카페 계좌 정보 등록 (owner only).
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useCafeManage } from "@/components/cafe/CafeManageContext"

export default function CafeAccountPage() {
  const { data, refresh } = useCafeManage()
  const [bank, setBank] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [holder, setHolder] = useState("")
  const [active, setActive] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  // bootstrap context 가 이미 account 갖고 있음 → 추가 fetch 없이 hydrate.
  useEffect(() => {
    if (data?.account) {
      setBank(data.account.bank_name ?? "")
      setAccountNumber(data.account.account_number ?? "")
      setHolder(data.account.account_holder ?? "")
      setActive(!!data.account.is_active)
    }
  }, [data])

  async function save() {
    setError(""); setSaved(false)
    const r = await apiFetch("/api/cafe/account", {
      method: "PUT",
      body: JSON.stringify({
        bank_name: bank.trim() || null,
        account_number: accountNumber.trim() || null,
        account_holder: holder.trim() || null,
        is_active: active,
      }),
    })
    const d = await r.json()
    if (!r.ok) { setError(d.message || "저장 실패"); return }
    setSaved(true)
    await refresh()  // bootstrap 갱신
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-md mx-auto space-y-3">
        <h1 className="text-lg font-semibold">☕ 카페 계좌 등록</h1>
        <p className="text-[11px] text-slate-400">계좌 입금 결제 시 주문자에게 표시됩니다.</p>
        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}
        {saved && <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">저장됨</div>}
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="은행 (예: 신한은행)"
          className="w-full rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
        <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="계좌번호"
          className="w-full rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm font-mono" />
        <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="예금주"
          className="w-full rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-cyan-500" />
          활성 (주문자에게 표시)
        </label>
        <button onClick={save}
          className="w-full py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold">
          저장
        </button>
      </div>
    </div>
  )
}
