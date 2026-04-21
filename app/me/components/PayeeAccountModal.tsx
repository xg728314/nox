"use client"

import type { PayeeForm } from "../hooks/usePayeeAccounts"

/**
 * PayeeAccountModal — create/edit payee account form. Pure UI.
 * Validation / submit / fetch all live in usePayeeAccounts.
 */

type Props = {
  open: boolean
  busy: boolean
  error: string
  form: PayeeForm
  onChange: (patch: Partial<PayeeForm>) => void
  onClose: () => void
  onSubmit: () => void
}

export default function PayeeAccountModal({
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
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[420px] max-w-[92vw] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">{isEdit ? "지급 대상 수정" : "지급 대상 등록"}</div>
        <div className="text-[11px] text-slate-500 mb-4">외부 / 실장 등 지급할 계좌를 등록합니다.</div>

        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
        )}

        <div className="space-y-2.5">
          <Field label="지급 대상명 *" value={form.payee_name} onChange={v => onChange({ payee_name: v })} placeholder="예: 홍길동" />
          <Field label="역할" value={form.role_type} onChange={v => onChange({ role_type: v })} placeholder="예: 외부실장" />
          <Field label="연결 멤버십 ID (선택)" value={form.linked_membership_id} onChange={v => onChange({ linked_membership_id: v })} placeholder="store_memberships.id (optional)" mono />
          <Field label="은행명 *" value={form.bank_name} onChange={v => onChange({ bank_name: v })} placeholder="예: 신한은행" />
          <Field label="예금주 *" value={form.account_holder_name} onChange={v => onChange({ account_holder_name: v })} />
          <Field label="계좌번호 *" value={form.account_number} onChange={v => onChange({ account_number: v })} />
          <Field label="메모" value={form.note} onChange={v => onChange({ note: v })} />

          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => onChange({ is_active: e.target.checked })}
              className="accent-cyan-500"
            />
            활성 (지급 대상으로 사용)
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

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600 ${mono ? "font-mono" : ""}`}
      />
    </div>
  )
}
