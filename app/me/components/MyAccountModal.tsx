"use client"

import type { MyAccountForm } from "../hooks/useMyAccounts"

/**
 * MyAccountModal — create/edit settlement account form. Pure UI.
 * Validation / submit / fetch all live in useMyAccounts.
 */

type Props = {
  open: boolean
  busy: boolean
  error: string
  form: MyAccountForm
  onChange: (patch: Partial<MyAccountForm>) => void
  onClose: () => void
  onSubmit: () => void
}

export default function MyAccountModal({
  open, busy, error, form, onChange, onClose, onSubmit,
}: Props) {
  if (!open) return null

  const isEdit = !!form.id

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[380px] max-w-[92vw] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">{isEdit ? "계좌 수정" : "계좌 등록"}</div>
        <div className="text-[11px] text-slate-500 mb-4">본인 계좌로만 등록하세요.</div>

        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
        )}

        <div className="space-y-2.5">
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">은행명 *</label>
            <input
              type="text"
              value={form.bank_name}
              onChange={e => onChange({ bank_name: e.target.value })}
              placeholder="예: 국민은행"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">계좌번호 *</label>
            <input
              type="text"
              value={form.account_number}
              onChange={e => onChange({ account_number: e.target.value })}
              placeholder="계좌번호"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">예금주 *</label>
            <input
              type="text"
              value={form.account_holder_name}
              onChange={e => onChange({ account_holder_name: e.target.value })}
              placeholder="이름"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">계좌 종류</label>
            <input
              type="text"
              value={form.account_type}
              onChange={e => onChange({ account_type: e.target.value })}
              placeholder="예: 자유입출금, 급여"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">메모</label>
            <input
              type="text"
              value={form.note}
              onChange={e => onChange({ note: e.target.value })}
              placeholder="메모 (선택)"
              className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
            />
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={e => onChange({ is_default: e.target.checked })}
              className="accent-cyan-500"
            />
            기본 계좌로 설정
          </label>

          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => onChange({ is_active: e.target.checked })}
              className="accent-cyan-500"
            />
            활성 (정산 대상)
          </label>
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
            className="py-2 rounded-xl text-xs font-semibold text-white bg-cyan-500/80 hover:bg-cyan-500 disabled:opacity-50"
          >{busy ? "저장 중..." : isEdit ? "저장" : "등록"}</button>
        </div>
      </div>
    </div>
  )
}
