/**
 * R-B: 방별 섹션 컨테이너 — 편집/저장 흐름의 메인.
 *
 * 책임:
 *   - extraction (또는 edit) 받아서 draft 로 보유
 *   - RoomCard N개 렌더, 각 변경을 draft 에 반영
 *   - 신뢰도 낮은 방 우선 정렬 옵션
 *   - 변경 감지 (dirty)
 *   - "저장" 클릭 → POST /api/reconcile/[id]/edit → 부모에 onSaved 콜백
 *   - "변경 취소" 시 draft = original
 *
 * 권한:
 *   - readOnly=true 면 input 모두 disabled, 저장 버튼 숨김
 */

"use client"

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { PaperExtraction, PaperRoomCell } from "@/lib/reconcile/types"
import { confidenceLevel } from "@/lib/reconcile/qualityHints"
import RoomCard from "./RoomCard"

export type RoomsEditorProps = {
  snapshotId: string
  extraction: PaperExtraction
  /** base extraction id — diff 의 추적용 (optional) */
  baseExtractionId?: string | null
  onSaved: () => void
  readOnly?: boolean
}

export default function RoomsEditor({
  snapshotId, extraction, baseExtractionId, onSaved, readOnly,
}: RoomsEditorProps) {
  const [draft, setDraft] = useState<PaperExtraction>(() => deepClone(extraction))
  const [sortByConfidence, setSortByConfidence] = useState(false)
  const [editReason, setEditReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  // extraction prop 이 바뀌면 draft 초기화 (예: 부모가 fetch 후 갱신)
  useEffect(() => {
    setDraft(deepClone(extraction))
    setSaved(false)
  }, [extraction])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(extraction),
    [draft, extraction],
  )

  const sortedRooms = useMemo(() => {
    const rooms = draft.rooms ?? []
    if (!sortByConfidence) return rooms
    // 신뢰도 낮은 순. undefined 는 마지막.
    return [...rooms].sort((a, b) => {
      const ca = a.confidence ?? 999
      const cb = b.confidence ?? 999
      return ca - cb
    })
  }, [draft.rooms, sortByConfidence])

  // 카운터 (검수 우선순위 표시)
  const counts = useMemo(() => {
    const out = { red: 0, amber: 0, green: 0, gray: 0 }
    for (const r of (draft.rooms ?? [])) {
      const lvl = confidenceLevel(r.confidence)
      out[lvl]++
    }
    return out
  }, [draft.rooms])

  function updateRoom(originalIdx: number, next: PaperRoomCell) {
    const arr = [...(draft.rooms ?? [])]
    arr[originalIdx] = next
    setDraft({ ...draft, rooms: arr })
  }
  function removeRoom(originalIdx: number) {
    if (!confirm("이 방을 삭제하시겠습니까?")) return
    const arr = [...(draft.rooms ?? [])]
    arr.splice(originalIdx, 1)
    setDraft({ ...draft, rooms: arr })
  }
  function discard() {
    if (!confirm("모든 변경을 취소하시겠습니까?")) return
    setDraft(deepClone(extraction))
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/${snapshotId}/edit`, {
        method: "POST",
        body: JSON.stringify({
          edited_json: draft,
          base_extraction_id: baseExtractionId ?? undefined,
          edit_reason: editReason.trim() || undefined,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "저장 실패")
        return
      }
      setSaved(true)
      setEditReason("")
      // 부모가 fetch 갱신 → extraction prop 변경 → useEffect 가 draft 재설정
      onSaved()
    } catch {
      setError("네트워크 오류")
    } finally {
      setSaving(false)
    }
  }

  // rooms 매핑 시 originalIdx 추적 — sortByConfidence 가 켜져 있어도 원래 인덱스로 update
  const indexedRooms = (draft.rooms ?? []).map((r, idx) => ({ r, idx }))
  const sortedIndexed = sortByConfidence
    ? [...indexedRooms].sort((a, b) => (a.r.confidence ?? 999) - (b.r.confidence ?? 999))
    : indexedRooms

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-cyan-200">📝 방별 검수 + 수정</div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-red-300" title="신뢰도 낮음">🔴 {counts.red}</span>
            <span className="text-amber-300" title="신뢰도 중간">🟡 {counts.amber}</span>
            <span className="text-emerald-300" title="신뢰도 높음">🟢 {counts.green}</span>
            <span className="text-slate-500" title="신뢰도 모름">⚪ {counts.gray}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="checkbox"
              checked={sortByConfidence}
              onChange={(e) => setSortByConfidence(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>신뢰도 낮은 방 먼저</span>
          </label>
          {dirty && !readOnly && (
            <span className="ml-auto text-amber-300">● 저장되지 않은 변경 있음</span>
          )}
          {saved && !dirty && (
            <span className="ml-auto text-emerald-300">✓ 저장됨</span>
          )}
        </div>
      </div>

      {/* 방 카드들 */}
      {sortedIndexed.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          추출된 방 데이터가 없습니다.
        </div>
      ) : (
        sortedIndexed.map(({ r, idx }) => (
          <RoomCard
            key={`room-${idx}`}
            room={r}
            onChange={(n) => updateRoom(idx, n)}
            onRemoveRoom={() => removeRoom(idx)}
            readOnly={readOnly}
          />
        ))
      )}

      {/* 저장 영역 */}
      {!readOnly && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <textarea
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="수정 사유 (선택) — 예: 조도 부족으로 OCR 가 받돈 잘못 읽음"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-xs"
          />
          {error && <div className="text-red-400 text-xs">{error}</div>}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={discard}
              disabled={!dirty || saving}
              className="py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm disabled:opacity-50"
            >변경 취소</button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold disabled:opacity-50"
            >{saving ? "저장 중..." : "변경사항 저장"}</button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            저장된 결과는 paper_ledger_edits 에 보관됩니다. NOX 운영 데이터는 변경되지 않습니다 (R-C 의 적용 기능은 별도 라운드).
          </p>
        </div>
      )}
    </div>
  )
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
