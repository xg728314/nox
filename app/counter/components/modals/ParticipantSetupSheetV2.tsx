"use client"

import type { SheetState, StaffItem } from "../../types"
import { STORES, CATEGORIES } from "../../types"
import { ticketToPreset } from "../../hooks/useParticipantMutations"

type Props = {
  sheet: SheetState
  onPatch: (p: Partial<SheetState>) => void
  onClose: () => void
  onLoadManagers: (storeName: string) => Promise<void>
  onCommit: () => void
}

export default function ParticipantSetupSheetV2({ sheet, onPatch, onClose, onLoadManagers, onCommit }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-[49] bg-black/50" onClick={() => !sheet.loading && onClose()} />
      <div className="fixed left-0 right-0 bottom-0 z-[50] bg-[#1c1c2e] rounded-t-2xl p-4 max-h-[60vh] overflow-y-auto border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]">
        {sheet.loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1c1c2e]/80 backdrop-blur-sm rounded-t-2xl">
            <div className="w-10 h-10 rounded-full border-[3px] border-cyan-400/30 border-t-cyan-400 animate-spin mb-3" />
            <span className="text-sm text-cyan-300">처리 중...</span>
          </div>
        )}
        <div className="mx-auto w-10 h-1 rounded-full bg-white/20 mb-4" />

        {/* Step 1: Store */}
        {sheet.step === "store" && (
          <>
            <div className="text-lg font-bold mb-3">가게 선택</div>
            <div className="grid grid-cols-3 gap-2">
              {STORES.map(s => (
                <button
                  key={s.name}
                  onClick={async () => {
                    onPatch({ store: s.name, category: null, timeMinutes: null, manager: null })
                    await onLoadManagers(s.name)
                    onPatch({ step: "category" })
                  }}
                  className="h-16 rounded-2xl bg-white/[0.06] border border-white/10 hover:bg-white/10 active:scale-95 transition-all flex flex-col items-center justify-center"
                >
                  <span className="text-sm font-semibold text-white">{s.name}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">{s.floor}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Category */}
        {sheet.step === "category" && sheet.store && (
          <>
            <div className="text-lg font-bold mb-3">종목 선택 · {sheet.store}</div>
            <div className="space-y-3">
              {CATEGORIES.map(c => {
                // BUG 3 — Category change must recalculate time.
                // Prefer ticketToPreset(ticket, category) when the sheet
                // knows the parsed ticket (staff-chat flow). This makes
                // category switching between 퍼블릭 ↔ 셔츠 re-derive the
                // correct time for 완티 / 반티 / 차3 / 반차3. For the
                // card-tap path (no ticketType hint) fall back to
                // CATEGORIES[c.name].minutes which is the legacy 완티
                // nominal minutes (90 / 60 / 60).
                const preset = ticketToPreset(sheet.ticketType, c.name)
                const derivedMinutes = preset?.time_minutes ?? c.minutes
                const label =
                  sheet.ticketType
                    ? `${derivedMinutes}분${sheet.ticketType ? ` · ${sheet.ticketType}` : ""}`
                    : `${c.minutes}분`
                return (
                  <button
                    key={c.name}
                    onClick={() => onPatch({
                      category: c.name,
                      timeMinutes: derivedMinutes,
                      manager: null,
                      step: "manager",
                    })}
                    className="w-full h-16 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/10 active:scale-95 transition-all flex items-center justify-between px-5 text-base font-semibold text-slate-200"
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-slate-500">{label}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Step 3: Manager */}
        {sheet.step === "manager" && sheet.category && (
          <>
            {/* Auto-resolved store back button — only rendered when the
                picker skipped the store step because the parser already
                matched exactly one store. Lets the operator correct an
                inferred-wrong store without closing the whole sheet. */}
            {sheet.isStoreAutoResolved && (
              <button
                type="button"
                onClick={() => onPatch({
                  step: "store",
                  isStoreAutoResolved: false,
                  store: "",
                  storeUuid: null,
                  managerList: [],
                  manager: null,
                })}
                className="mb-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
              >
                <span aria-hidden>←</span>
                <span>가게 다시 선택</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300 font-medium">{sheet.store}</span>
              </button>
            )}
            <div className="text-lg font-bold mb-2">담당 실장 · {sheet.store} · {sheet.category}</div>
            <p className="text-xs text-slate-400 mb-3">담당 실장을 선택하세요. 이름은 확정 후 카드에서 입력합니다.</p>
            {sheet.managerList.length > 0 ? (
              <div className="space-y-2 mb-3">
                {sheet.managerList.map((m: StaffItem) => (
                  <button
                    key={m.membership_id}
                    onClick={() => onPatch({ manager: { membership_id: m.membership_id, name: m.name } })}
                    className={`w-full flex items-center gap-3 h-14 rounded-2xl border px-4 transition-all ${
                      sheet.manager?.membership_id === m.membership_id
                        ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                        : "bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-200"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400/50 to-indigo-500/50 flex items-center justify-center text-sm font-bold">
                      {m.name.charAt(0)}
                    </div>
                    <span className="text-sm font-semibold flex-1 text-left">{m.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-slate-500 mb-3">등록된 실장이 없습니다</div>
            )}
            <button
              onClick={() => { if (sheet.manager) onCommit() }}
              disabled={sheet.loading || !sheet.manager}
              className={`w-full h-14 rounded-2xl text-base font-semibold transition-all ${sheet.manager ? "bg-[linear-gradient(90deg,#0ea5e9,#2563eb)]" : "bg-white/10 text-slate-500 cursor-not-allowed"}`}
            >
              {/*
                BUG 1 — manager change label.
                  - No selection yet        → "실장 선택"
                  - Existing manager on row → "실장 변경" (operator is
                    changing an already-assigned manager; never blocked)
                  - New row, just picked    → "실장 선택" (commit)
                `hasExistingManager` is surfaced by the container via
                `sheet.managerList` containing the current one. We detect
                it by checking if the SELECTED manager differs from the
                participant's current manager_membership_id — but the
                sheet doesn't carry that field directly. Instead we key
                the label purely off selection state: if selected, call
                it "실장 변경" regardless (safest UX — never implies
                first-time lock).
              */}
              {!sheet.manager ? "실장 선택" : "실장 변경"}
            </button>
          </>
        )}
      </div>
    </>
  )
}
