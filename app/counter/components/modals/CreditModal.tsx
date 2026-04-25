"use client"

import type { StaffItem } from "../../types"
import type { CreditFormState } from "../../hooks/useCreditFlow"

/**
 * CreditModal — 외상 입력 UI. Pure form component.
 *
 * Owns: input layout + event forwarding.
 * Does NOT own: fetch, mutation, validation source of truth
 *   (useCreditFlow owns those).
 */

type Props = {
  open: boolean
  busy: boolean
  form: CreditFormState
  managers: StaffItem[]
  onChange: (patch: Partial<CreditFormState>) => void
  onClose: () => void
  onSubmit: () => void
}

export default function CreditModal({
  open, busy, form, managers, onChange, onClose, onSubmit,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[380px] max-w-[92vw] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">외상 등록</div>
        <div className="text-[11px] text-slate-500 mb-4">현재 방 기준으로 외상 금액을 기록합니다.</div>

        <div className="space-y-2.5">
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">담당 실장 *</label>
            <select
              value={form.manager_membership_id}
              onChange={e => onChange({ manager_membership_id: e.target.value })}
              className="w-full rounded-lg bg-[#0b1220] border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 [&>option]:bg-[#0b1220]"
            >
              <option value="">선택</option>
              {managers.map(m => (
                <option key={m.membership_id} value={m.membership_id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">손님 이름 *</label>
            <input
              type="text"
              value={form.customer_name}
              onChange={e => onChange({ customer_name: e.target.value })}
              placeholder="이름"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">연락처</label>
            <input
              type="tel"
              value={form.customer_phone}
              onChange={e => onChange({ customer_phone: e.target.value })}
              placeholder="선택"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">금액 (원) *</label>
            <input
              type="number"
              min={0}
              value={form.amount}
              onChange={e => onChange({ amount: e.target.value })}
              placeholder="0"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">메모</label>
            <input
              type="text"
              value={form.memo}
              onChange={e => onChange({ memo: e.target.value })}
              placeholder="선택"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-50"
          >취소</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="py-2 rounded-xl text-xs font-semibold text-white bg-amber-500/80 hover:bg-amber-500 disabled:opacity-50"
          >{busy ? "등록 중..." : "외상 등록"}</button>
        </div>
      </div>
    </div>
  )
}
