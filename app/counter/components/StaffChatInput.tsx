"use client"

/**
 * StaffChatInput — pure UI component for the room-level staff-add
 * chat-style input.
 *
 * Purposely STATELESS and MUTATION-FREE:
 *   - no hooks
 *   - no API calls
 *   - no parsing logic
 *   - no chat-send logic
 *
 * The caller owns `value`, `onChange`, and `onSubmit`. Later phases will
 * wire `onSubmit` to a parsing helper + staff-add flow, and optionally
 * fan out to the existing room-session chat_rooms API. For Phase 3,
 * `onSubmit` is a stub.
 *
 * Help text mirrors the parse-rule hint intended for the feature:
 *   - "라 시은 은지 미자 퍼 완 메"     — store 약어 + 이름들 + 종목+티형태
 *   - "버 유라 수진 반"                 — 한 줄 = 같은 가게로 묶음
 *   - "가게 약어 다음 이름 여러 개는 같은 가게로 묶음"
 */

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
  /** Optional label override — defaults to "스태프 일괄 추가" */
  label?: string
}

export default function StaffChatInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  label = "스태프 일괄 추가",
}: Props) {
  const canSubmit = !disabled && value.trim().length > 0

  return (
    <div className="px-3 py-2 border-t border-white/10 bg-black/20">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-cyan-300">{label}</span>
        <span className="text-[9px] text-slate-500">엔터=줄바꿈 · 버튼=등록</span>
      </div>
      <div className="flex gap-1.5">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder={"예)\n라 시은 은지 미자 퍼 완 메\n버 유라 수진 반"}
          className="flex-1 resize-none rounded-lg bg-white/[0.04] border border-white/10 text-[12px] text-white px-2.5 py-1.5 leading-tight outline-none focus:border-cyan-500/40 placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => {
            if (!canSubmit) return
            onSubmit()
          }}
          disabled={!canSubmit}
          className="flex-shrink-0 w-16 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-[12px] font-semibold text-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          등록
        </button>
      </div>
    </div>
  )
}
