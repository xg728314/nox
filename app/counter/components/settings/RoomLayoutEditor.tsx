"use client"

/**
 * RoomLayoutEditor — Phase D + Phase 1 presets + Phase 2 admin override.
 *
 * Features:
 *   - Preset picker (PRESET config → draft, no auto-save)
 *   - Drag-reorder + up/down + visibility toggle (unchanged)
 *   - User save/reset (personal pref) — honest success/failure
 *   - Forced-override banner when admin override is active
 *   - Admin section (owner / super-admin) to apply/clear forced override
 *     from current draft
 *
 * Invariants preserved:
 *   - Locked widgets (togglable=false) cannot be hidden or moved
 *   - Unknown ids silently dropped
 *   - Hidden list filtered to togglable=true at save-time normalization
 *   - Preset application ONLY mutates the draft — never persists
 *   - Reset ≠ "last preset"; reset deletes the user pref, draft reverts
 *     to DEFAULT_ROOM_LAYOUT for immediate preview
 */

import { useEffect, useMemo, useState } from "react"
import { WIDGET_MANIFEST, WIDGET_BY_ID, type WidgetId } from "../../widgets/manifest"
import { DEFAULT_ROOM_LAYOUT, type RoomLayoutConfig } from "../../widgets/layoutTypes"
import { useRoomLayout } from "../../hooks/useRoomLayout"
import DragReorderList, { type DragRowItem } from "./DragReorderList"
import ScopeSelector, { type ScopeTarget } from "./ScopeSelector"
import PresetPicker from "./PresetPicker"
import { ROOM_LAYOUT_PRESETS } from "@/lib/counter/roomLayoutPresets"
import type { CounterMenuRole } from "@/lib/counter/menu"

type Props = {
  storeUuid: string | null
  role: CounterMenuRole | null
  /** super-admin 여부 — 전역 forced override 조작용. */
  isSuperAdmin?: boolean
  onClose?: () => void
}

function orderAllKnownWidgets(order: WidgetId[]): WidgetId[] {
  const seen = new Set<WidgetId>()
  const out: WidgetId[] = []
  for (const id of order) {
    if (!WIDGET_BY_ID.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  for (const def of WIDGET_MANIFEST) {
    if (seen.has(def.id)) continue
    seen.add(def.id)
    out.push(def.id)
  }
  return out
}

function normalize(draft: RoomLayoutConfig): RoomLayoutConfig {
  return {
    version: 1,
    order: orderAllKnownWidgets(draft.order),
    hidden: draft.hidden.filter(id => {
      const def = WIDGET_BY_ID.get(id)
      return def?.togglable === true
    }),
  }
}

export default function RoomLayoutEditor({
  storeUuid, role, isSuperAdmin = false, onClose,
}: Props) {
  const {
    layout, loading, setLayout, resetLayout,
    forcedActive, forcedSource,
    setForcedLayout, resetForcedLayout,
  } = useRoomLayout(storeUuid)

  const [target, setTarget] = useState<ScopeTarget>(storeUuid ? "store" : "global")
  const [draft, setDraft] = useState<RoomLayoutConfig>(layout)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string>("")

  useEffect(() => {
    if (!loading) setDraft(layout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const orderedIds = useMemo(() => orderAllKnownWidgets(draft.order), [draft.order])
  const hiddenSet = useMemo(() => new Set<WidgetId>(draft.hidden), [draft.hidden])

  const canAdminStore =
    isSuperAdmin ||
    (role === "owner" && !!storeUuid)
  const canAdminGlobal = isSuperAdmin

  const toggleHidden = (id: WidgetId) => {
    const def = WIDGET_BY_ID.get(id)
    if (!def || !def.togglable) return
    setDraft(prev => {
      const h = new Set(prev.hidden)
      if (h.has(id)) h.delete(id); else h.add(id)
      return { ...prev, hidden: [...h] }
    })
  }
  const reorder = (from: number, to: number) => {
    setDraft(prev => {
      const full = orderAllKnownWidgets(prev.order)
      const arr = [...full]
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return { ...prev, order: arr }
    })
  }

  const applyPreset = (config: RoomLayoutConfig) => {
    // Presets only touch the draft. Nothing is persisted until the user
    // clicks 저장. Normalization still runs at save time.
    setDraft({
      version: 1,
      order: [...config.order],
      hidden: [...config.hidden],
    })
    setStatus("프리셋 적용 — 저장 전까지는 반영되지 않음.")
  }

  const handleSave = async () => {
    setSaving(true); setStatus("")
    try {
      const ok = await setLayout(normalize(draft), target)
      setStatus(ok ? "저장 완료" : "저장 실패 — 다시 시도해주세요.")
    } finally { setSaving(false) }
  }

  const handleReset = async () => {
    setSaving(true); setStatus("")
    try {
      const ok = await resetLayout(target)
      if (ok) {
        setDraft(DEFAULT_ROOM_LAYOUT)
        setStatus("기본값으로 되돌림")
      } else {
        setStatus("초기화 실패 — 다시 시도해주세요.")
      }
    } finally { setSaving(false) }
  }

  const handleApplyForced = async (t: "store" | "global") => {
    setSaving(true); setStatus("")
    try {
      const ok = await setForcedLayout(normalize(draft), t)
      setStatus(ok
        ? (t === "store" ? "이 매장 강제 override 적용됨" : "전역 강제 override 적용됨")
        : "강제 override 적용 실패 — 권한 또는 네트워크 확인")
    } finally { setSaving(false) }
  }

  const handleClearForced = async (t: "store" | "global") => {
    setSaving(true); setStatus("")
    try {
      const ok = await resetForcedLayout(t)
      setStatus(ok
        ? (t === "store" ? "이 매장 강제 override 해제됨" : "전역 강제 override 해제됨")
        : "강제 override 해제 실패 — 권한 또는 네트워크 확인")
    } finally { setSaving(false) }
  }

  const rows: DragRowItem[] = orderedIds.map(id => {
    const def = WIDGET_BY_ID.get(id)!
    const hidden = def.togglable && hiddenSet.has(id)
    return {
      id: def.id,
      locked: !def.togglable,
      content: (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-slate-200 font-medium truncate">{def.label}</span>
          <span className="text-[9px] uppercase tracking-wide text-slate-500 px-1.5 py-0.5 rounded bg-white/[0.04] flex-shrink-0">
            {def.group}
          </span>
          {def.togglable ? (
            <button
              type="button"
              onClick={() => toggleHidden(def.id)}
              className={`ml-auto text-[10px] px-2 py-0.5 rounded-md border flex-shrink-0 ${
                hidden
                  ? "bg-slate-500/10 border-slate-500/30 text-slate-400"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
              }`}
            >{hidden ? "숨김" : "표시"}</button>
          ) : (
            <span
              className="ml-auto text-[10px] text-amber-400/80 flex-shrink-0"
              title={def.lockedReason ?? "필수 위젯 — 숨길 수 없음"}
            >필수</span>
          )}
        </div>
      ),
    }
  })

  const forcedBanner = forcedActive && (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
      <div className="font-bold mb-0.5">
        {forcedSource === "store"
          ? "관리자 강제 레이아웃 (이 매장)"
          : "관리자 강제 레이아웃 (전역)"} 적용 중
      </div>
      <div className="text-amber-200/80">
        런타임은 이 강제 레이아웃을 사용합니다. 아래에서 개인 저장을 바꿔도
        강제 override 가 해제되기 전까지 화면에는 반영되지 않습니다.
      </div>
    </div>
  )

  const adminBlock = (canAdminStore || canAdminGlobal) && (
    <div className="mt-2 p-2.5 rounded-lg border border-red-500/30 bg-red-500/[0.06] space-y-1.5">
      <div className="text-[11px] text-red-300 font-bold">관리자 강제 override</div>
      <div className="text-[10px] text-slate-400 leading-tight">
        현재 draft 를 이 레이어에 강제 적용합니다. 모든 사용자의 개인 설정보다
        우선합니다.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {canAdminStore && (
          <>
            <button
              type="button"
              onClick={() => handleApplyForced("store")}
              disabled={saving || loading || !storeUuid}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-red-200 bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-40"
            >이 매장 강제 적용</button>
            <button
              type="button"
              onClick={() => handleClearForced("store")}
              disabled={saving || loading || !storeUuid}
              className="px-2.5 py-1 rounded-md text-[11px] text-slate-300 border border-white/10 hover:bg-white/5 disabled:opacity-40"
            >이 매장 강제 해제</button>
          </>
        )}
        {canAdminGlobal && (
          <>
            <span className="text-slate-700 text-[10px] mx-1">·</span>
            <button
              type="button"
              onClick={() => handleApplyForced("global")}
              disabled={saving || loading}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-red-200 bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-40"
            >전체 강제 적용</button>
            <button
              type="button"
              onClick={() => handleClearForced("global")}
              disabled={saving || loading}
              className="px-2.5 py-1 rounded-md text-[11px] text-slate-300 border border-white/10 hover:bg-white/5 disabled:opacity-40"
            >전체 강제 해제</button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {forcedBanner}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-400">방 카드 위젯 순서 / 표시 설정</div>
        <ScopeSelector target={target} onChange={setTarget} storeDisabled={!storeUuid} />
      </div>

      <PresetPicker presets={ROOM_LAYOUT_PRESETS} onApply={applyPreset} />

      {loading ? (
        <div className="py-6 text-center text-sm text-slate-500 animate-pulse">불러오는 중…</div>
      ) : (
        <DragReorderList items={rows} onReorder={reorder} />
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
        <div className="text-[11px] text-slate-500 min-h-[1em]">{status}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || loading}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-300 border border-white/10 hover:bg-white/5 disabled:opacity-40"
          >기본값으로</button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200"
            >닫기</button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || forcedActive}
            title={forcedActive ? "관리자 강제 override 가 적용 중 — 개인 저장은 지금 반영되지 않습니다." : undefined}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-200 bg-cyan-500/20 border border-cyan-500/40 hover:bg-cyan-500/30 disabled:opacity-40"
          >{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>

      {adminBlock}
    </div>
  )
}
