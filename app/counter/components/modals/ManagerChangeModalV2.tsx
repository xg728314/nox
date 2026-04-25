"use client"

import type { MgrModalState } from "../../types"

type Props = {
  mgr: MgrModalState
  busy: boolean
  onPatch: (p: Partial<MgrModalState>) => void
  onClose: () => void
  onSave: () => void
}

export default function ManagerChangeModalV2({ mgr, busy, onPatch, onClose, onSave }: Props) {
  const hasSelection = mgr.isExternal ? !!mgr.externalName.trim() : !!mgr.selected

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#0d1020] border border-white/10 p-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-base font-bold">담당 실장 변경</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 1차: 내부 실장 목록 (기본 경로) */}
        {!mgr.isExternal && (
          <>
            <div className="text-[11px] text-slate-500 mb-2 font-medium">내부 실장</div>
            <div className="max-h-52 overflow-y-auto space-y-1.5 mb-3">
              {mgr.staffList.length === 0 ? (
                <div className="py-6 text-center">
                  <div className="text-xs text-slate-500 mb-1">등록된 실장이 없습니다</div>
                  <div className="text-[10px] text-slate-600">아래에서 외부 실장을 직접 입력할 수 있습니다</div>
                </div>
              ) : mgr.staffList.map(s => (
                <button
                  key={s.membership_id}
                  onClick={() => onPatch({ selected: { membership_id: s.membership_id, name: s.name } })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                    mgr.selected?.membership_id === s.membership_id
                      ? "bg-purple-500/20 text-purple-200 border border-purple-500/40"
                      : "bg-white/[0.04] text-slate-200 border border-white/[0.06] hover:bg-white/[0.08]"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    mgr.selected?.membership_id === s.membership_id
                      ? "bg-purple-500/40 text-purple-200"
                      : "bg-white/10 text-slate-400"
                  }`}>
                    {s.name.charAt(0)}
                  </div>
                  <span className="font-medium text-left flex-1">{s.name}</span>
                  {mgr.selected?.membership_id === s.membership_id && (
                    <span className="text-purple-400 text-xs">✓</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* 2차: 외부 실장 (보조 경로) */}
        {mgr.isExternal ? (
          <>
            <div className="text-[11px] text-slate-500 mb-2 font-medium">외부 실장 직접 입력</div>
            <div className="space-y-2 mb-3">
              <input
                value={mgr.externalOrg}
                onChange={e => onPatch({ externalOrg: e.target.value })}
                placeholder="소속 (매장명)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              />
              <input
                value={mgr.externalName}
                onChange={e => onPatch({ externalName: e.target.value })}
                placeholder="실장 이름"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              />
            </div>
            <button
              onClick={() => onPatch({ isExternal: false, externalOrg: "", externalName: "" })}
              className="w-full mb-4 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← 내부 실장 목록으로 돌아가기
            </button>
          </>
        ) : (
          <button
            onClick={() => onPatch({ isExternal: true, selected: null })}
            className="w-full mb-4 py-2 rounded-xl text-[11px] text-slate-500 border border-dashed border-white/10 hover:border-white/20 hover:text-slate-300 transition-colors"
          >
            외부 실장 직접 입력 →
          </button>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 text-slate-300 text-sm hover:bg-white/10 transition-colors">
            취소
          </button>
          <button
            onClick={onSave}
            disabled={busy || !hasSelection}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              hasSelection
                ? "bg-cyan-500/80 text-white hover:bg-cyan-500/90"
                : "bg-white/5 text-slate-600 cursor-not-allowed"
            } disabled:opacity-50`}
          >
            저장
          </button>
        </div>

      </div>
    </div>
  )
}
