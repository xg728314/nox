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
  /** R-A v5: 매장 호스티스/매장명 후보 — RoomCard 의 datalist 로 forward */
  knownHostesses?: string[]
  knownStores?: string[]
}

export default function RoomsEditor({
  snapshotId, extraction, baseExtractionId, onSaved, readOnly,
  knownHostesses, knownStores,
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

  // 2026-05-01 R-AutoPrice UI: 시트 전체 줄돈/받돈 합계.
  //   rooms 의 staff_entries 매장별 묶음 + daily_summary.recv 박스.
  const sheetTotals = useMemo(() => computeSheetTotals(draft), [draft])

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

      {/* 2026-05-01 R-AutoPrice UI: 시트 전체 매장별 줄돈/받을돈 + 합계 */}
      <SheetOweSummary
        owePerStore={sheetTotals.owePerStore}
        recvPerStore={sheetTotals.recvPerStore}
        oweTotal={sheetTotals.oweTotal}
        recvTotal={sheetTotals.recvTotal}
      />

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
            knownHostesses={knownHostesses}
            knownStores={knownStores}
            datalistIdPrefix={`room-${idx}`}
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

// ─── 시트 전체 매장별 줄돈/받돈 합계 ─────────────────────────
//
// R-AutoPrice (2026-05-01):
//   "받을돈 총 얼마. 줄돈 총얼마" — 시트 전체 합계 + 매장별 분할.
//   줄돈: rooms[*].staff_entries[*].hostess_payout_won, origin_store 별 묶음.
//   받돈: daily_summary.recv (그 시점에 종이에 적힌 외부 매장에서 받을 돈).

type StoreAmount = { store_name: string; amount_won: number }
type SheetTotals = {
  owePerStore: StoreAmount[]
  recvPerStore: StoreAmount[]
  oweTotal: number
  recvTotal: number
}

function computeSheetTotals(extraction: PaperExtraction): SheetTotals {
  const oweByStore = new Map<string, number>()
  for (const room of extraction.rooms ?? []) {
    for (const e of room.staff_entries ?? []) {
      const name = (e.origin_store ?? "").trim()
      const amt = e.hostess_payout_won ?? 0
      if (!name || !amt) continue
      oweByStore.set(name, (oweByStore.get(name) ?? 0) + amt)
    }
  }
  const owePerStore: StoreAmount[] = Array.from(oweByStore.entries())
    .map(([name, amt]) => ({ store_name: name, amount_won: amt }))
    .sort((a, b) => b.amount_won - a.amount_won)

  const recvByStore = new Map<string, number>()
  for (const r of extraction.daily_summary?.recv ?? []) {
    const name = (r.store_name ?? "").trim()
    const amt = r.amount_won ?? 0
    if (!name) continue
    recvByStore.set(name, (recvByStore.get(name) ?? 0) + amt)
  }
  const recvPerStore: StoreAmount[] = Array.from(recvByStore.entries())
    .map(([name, amt]) => ({ store_name: name, amount_won: amt }))
    .sort((a, b) => b.amount_won - a.amount_won)

  return {
    owePerStore,
    recvPerStore,
    oweTotal: owePerStore.reduce((s, x) => s + x.amount_won, 0),
    recvTotal: recvPerStore.reduce((s, x) => s + x.amount_won, 0),
  }
}

function fmtWon(n: number): string {
  return `₩${n.toLocaleString()}`
}

function SheetOweSummary({
  owePerStore,
  recvPerStore,
  oweTotal,
  recvTotal,
}: SheetTotals) {
  if (owePerStore.length === 0 && recvPerStore.length === 0) return null
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-3">
      <div className="text-sm font-semibold text-emerald-200">📊 전체 매장별 정산 합계</div>
      <div className="grid md:grid-cols-2 gap-3">
        {/* 줄돈 (외부 매장에 보낼 돈) */}
        <div className="rounded-lg bg-black/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-200">줄돈 (보낼 돈)</span>
            <span className="text-[11px] text-amber-200 tabular-nums font-bold">
              {fmtWon(oweTotal)}
            </span>
          </div>
          {owePerStore.length === 0 ? (
            <div className="text-[10px] text-slate-500">없음</div>
          ) : (
            owePerStore.map((s) => (
              <div key={s.store_name} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">{s.store_name}</span>
                <span className="text-amber-200 tabular-nums font-semibold">
                  {fmtWon(s.amount_won)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 받을돈 (외부 매장에서 받을 돈) */}
        <div className="rounded-lg bg-black/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-cyan-200">받을돈 (받을 돈)</span>
            <span className="text-[11px] text-cyan-200 tabular-nums font-bold">
              {fmtWon(recvTotal)}
            </span>
          </div>
          {recvPerStore.length === 0 ? (
            <div className="text-[10px] text-slate-500">없음</div>
          ) : (
            recvPerStore.map((s) => (
              <div key={s.store_name} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">{s.store_name}</span>
                <span className="text-cyan-200 tabular-nums font-semibold">
                  {fmtWon(s.amount_won)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">
        같은 매장이 줄돈과 받돈에 동시에 있으면 별도 행으로 분리 표시됩니다 (서로 상쇄 X).
      </div>
    </div>
  )
}
