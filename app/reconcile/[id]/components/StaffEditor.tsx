"use client"

/**
 * StaffEditor — 스태프 종이장부 추출 결과 편집 + 담당실장 매핑.
 *
 * 2026-04-30 (R-staff-editor):
 *   기존 StaffDisplay 는 read-only. 운영자 요청:
 *     1) 담당실장 선택 가능 → 정산/PnL 연동
 *     2) 글씨 수정 가능 → 누적 학습 정확도 향상
 *
 *   동작:
 *     - extraction prop 을 draft 로 복사 후 inline 편집.
 *     - hostess 별: 이름 / 담당실장 dropdown / 매핑된 hostess (datalist).
 *     - 세션 별: 시간 / 가게 / 종목 / 시간티어 inline edit. raw_text 는 reference.
 *     - "저장" → POST /api/reconcile/[id]/edit (RoomsEditor 와 동일 흐름).
 *     - 부모 onSaved() 가 fetch 갱신 → useEffect 가 draft 재설정.
 *
 *   학습 누적:
 *     paper_ledger_edits 에 저장된 (raw, edited) 쌍이 매장별 누적 →
 *     prompt 에 store_known_hostesses / store_symbol_dictionary 로 다시
 *     주입 (lib/reconcile/extract.ts) → 다음 추출부터 자동 인식률 ↑.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type {
  PaperExtraction, PaperStaffRow, StaffSession,
  ServiceType, TimeTier,
} from "@/lib/reconcile/types"
import ConfidenceBadge from "./ConfidenceBadge"

type Manager = {
  membership_id: string
  name: string
}

const SERVICE_OPTIONS: ServiceType[] = ["퍼블릭", "셔츠", "하퍼"]
const TIER_OPTIONS: TimeTier[] = ["free", "차3", "반티", "반차3", "완티", "unknown"]

export default function StaffEditor({
  snapshotId,
  extraction,
  baseExtractionId,
  onSaved,
  readOnly,
  knownHostesses = [],
  knownStores = [],
}: {
  snapshotId: string
  extraction: PaperExtraction
  baseExtractionId?: string | null
  onSaved: () => void
  readOnly?: boolean
  knownHostesses?: string[]
  knownStores?: string[]
}) {
  const [draft, setDraft] = useState<PaperExtraction>(() => deepClone(extraction))
  const [managers, setManagers] = useState<Manager[]>([])
  const [editReason, setEditReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  // extraction prop 갱신 시 draft 재설정
  useEffect(() => {
    setDraft(deepClone(extraction))
    setSaved(false)
  }, [extraction])

  // 매장 manager 목록 fetch (담당실장 dropdown 용)
  useEffect(() => {
    let cancelled = false
    apiFetch("/api/store/staff?role=manager")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return
        const list = (d.staff ?? d.items ?? []) as Array<Record<string, unknown>>
        const out: Manager[] = list
          .map((m) => ({
            membership_id: String(m.membership_id ?? m.id ?? ""),
            name: String(m.name ?? m.full_name ?? ""),
          }))
          .filter((m) => m.membership_id && m.name)
        setManagers(out)
      })
      .catch(() => { /* dropdown 비어있어도 편집은 가능 */ })
    return () => { cancelled = true }
  }, [])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(extraction),
    [draft, extraction],
  )

  function updateRow(idx: number, next: PaperStaffRow) {
    const arr = [...(draft.staff ?? [])]
    arr[idx] = next
    setDraft({ ...draft, staff: arr })
  }
  function updateSession(rowIdx: number, sIdx: number, next: StaffSession) {
    const arr = [...(draft.staff ?? [])]
    const sessions = [...(arr[rowIdx]?.sessions ?? [])]
    sessions[sIdx] = next
    arr[rowIdx] = { ...arr[rowIdx], sessions }
    setDraft({ ...draft, staff: arr })
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
      onSaved()
    } catch {
      setError("네트워크 오류")
    } finally {
      setSaving(false)
    }
  }

  const staff = (draft.staff ?? []) as PaperStaffRow[]

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-cyan-200">📋 스태프 검수 + 수정</div>
          <div className="text-[10px] text-slate-500">
            총 {staff.length} 명 · 영업일 {extraction.business_date ?? "?"}
          </div>
        </div>
        <div className="text-[11px] text-slate-400">
          담당실장 선택 + 글씨 수정 후 저장하면 정산 연동 + AI 학습 데이터로 사용됩니다.
        </div>
        {dirty && !readOnly && (
          <div className="text-[11px] text-amber-300">● 저장되지 않은 변경 있음</div>
        )}
        {saved && !dirty && (
          <div className="text-[11px] text-emerald-300">✓ 저장됨</div>
        )}
      </div>

      {/* hostess 카드들 */}
      {staff.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          추출된 스태프가 없습니다. 재추출 또는 더 선명한 사진이 필요합니다.
        </div>
      ) : (
        staff.map((row, idx) => (
          <HostessCard
            key={`hostess-${idx}`}
            row={row}
            idx={idx}
            managers={managers}
            knownHostesses={knownHostesses}
            knownStores={knownStores}
            readOnly={readOnly}
            onChange={(n) => updateRow(idx, n)}
            onChangeSession={(sIdx, n) => updateSession(idx, sIdx, n)}
          />
        ))
      )}

      {/* 저장 영역 */}
      {!readOnly && staff.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2 sticky bottom-2">
          <div className="flex gap-2">
            <input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="수정 이유 (선택, 예: '글씨 흐려서 정정')"
              className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs"
            />
            <button
              onClick={discard}
              disabled={!dirty || saving}
              className="px-3 py-1.5 rounded bg-white/[0.04] border border-white/10 text-xs hover:bg-white/[0.08] disabled:opacity-30"
            >
              취소
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-4 py-1.5 rounded bg-cyan-500/25 border border-cyan-400/40 text-cyan-100 text-xs font-semibold hover:bg-cyan-500/35 disabled:opacity-30"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
          {error && <div className="text-[11px] text-red-300">{error}</div>}
        </div>
      )}
    </div>
  )
}

// ─── HostessCard ─────────────────────────────────────────

function HostessCard({
  row, idx, managers, knownHostesses, knownStores, readOnly,
  onChange, onChangeSession,
}: {
  row: PaperStaffRow
  idx: number
  managers: Manager[]
  knownHostesses: string[]
  knownStores: string[]
  readOnly?: boolean
  onChange: (next: PaperStaffRow) => void
  onChangeSession: (sIdx: number, next: StaffSession) => void
}) {
  const dlHostess = `dl-hostess-${idx}`
  const dlStore = `dl-store-${idx}`

  const totals = row.daily_totals ?? []
  const totalCount = totals[0]
  const owe = totals[1]

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* hostess 헤더 — 이름 / 담당실장 / 총갯수 / 줄돈 */}
      <div className="px-3 py-2.5 bg-white/[0.04] border-b border-white/5 grid grid-cols-12 gap-2 items-center">
        <div className="col-span-1 text-[11px] text-slate-500">#{idx + 1}</div>

        {/* 이름 */}
        <div className="col-span-3">
          <div className="text-[10px] text-slate-500 mb-0.5">이름</div>
          <input
            value={row.hostess_name ?? ""}
            onChange={(e) => onChange({ ...row, hostess_name: e.target.value })}
            disabled={readOnly}
            list={dlHostess}
            placeholder="이름"
            className="w-full bg-black/30 border border-cyan-500/30 rounded px-2 py-1 text-sm font-semibold text-cyan-200"
          />
          <datalist id={dlHostess}>
            {knownHostesses.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>

        {/* 담당실장 */}
        <div className="col-span-4">
          <div className="text-[10px] text-slate-500 mb-0.5">담당실장</div>
          <select
            value={row.manager_membership_id ?? ""}
            onChange={(e) =>
              onChange({ ...row, manager_membership_id: e.target.value || null })
            }
            disabled={readOnly}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
          >
            <option value="">— 선택 —</option>
            {managers.map((m) => (
              <option key={m.membership_id} value={m.membership_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* 총갯수 */}
        <div className="col-span-2">
          <div className="text-[10px] text-slate-500 mb-0.5">총갯수</div>
          <input
            type="number"
            value={typeof totalCount === "number" ? totalCount : ""}
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Number(e.target.value)
              const newTotals = [...totals]
              newTotals[0] = v as number
              onChange({ ...row, daily_totals: newTotals })
            }}
            disabled={readOnly}
            className="w-full bg-black/30 border border-cyan-500/30 rounded px-2 py-1 text-sm text-right tabular-nums text-cyan-300"
          />
        </div>

        {/* 줄돈 */}
        <div className="col-span-2">
          <div className="text-[10px] text-slate-500 mb-0.5">줄돈</div>
          <input
            type="number"
            value={typeof owe === "number" ? owe : ""}
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Number(e.target.value)
              const newTotals = [...totals]
              if (newTotals.length < 2) newTotals.push(0)
              newTotals[1] = v as number
              onChange({ ...row, daily_totals: newTotals })
            }}
            disabled={readOnly}
            className="w-full bg-black/30 border border-amber-500/30 rounded px-2 py-1 text-sm text-right tabular-nums text-amber-300"
          />
        </div>
      </div>

      {/* 세션 행들 — 인라인 편집 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-white/5">
              <th className="text-left px-3 py-1.5 w-20">시간</th>
              <th className="text-left px-3 py-1.5 w-28">가게</th>
              <th className="text-left px-3 py-1.5 w-24">종목</th>
              <th className="text-left px-3 py-1.5 w-24">티어</th>
              <th className="text-left px-3 py-1.5">원본 (참고)</th>
              <th className="text-right px-3 py-1.5 w-12">신뢰</th>
            </tr>
          </thead>
          <tbody>
            {row.sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-slate-600">
                  세션 없음
                </td>
              </tr>
            ) : (
              row.sessions.map((s, sIdx) => (
                <SessionRow
                  key={sIdx}
                  s={s}
                  readOnly={readOnly}
                  knownStoreList={knownStores}
                  dlStoreId={dlStore}
                  onChange={(n) => onChangeSession(sIdx, n)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <datalist id={dlStore}>
        {knownStores.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  )
}

function SessionRow({
  s, readOnly, knownStoreList: _knownStoreList, dlStoreId, onChange,
}: {
  s: StaffSession
  readOnly?: boolean
  knownStoreList: string[]
  dlStoreId: string
  onChange: (next: StaffSession) => void
}) {
  return (
    <tr className="border-b border-white/[0.03]">
      <td className="px-3 py-1.5">
        <input
          value={s.time ?? ""}
          onChange={(e) => onChange({ ...s, time: e.target.value })}
          disabled={readOnly}
          placeholder="HH:MM"
          className="w-16 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs tabular-nums"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          value={s.store ?? ""}
          onChange={(e) => onChange({ ...s, store: e.target.value })}
          disabled={readOnly}
          list={dlStoreId}
          placeholder="가게"
          className="w-24 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs"
        />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={s.service_type ?? ""}
          onChange={(e) =>
            onChange({ ...s, service_type: (e.target.value || undefined) as ServiceType | undefined })
          }
          disabled={readOnly}
          className="w-20 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs"
        >
          <option value="">-</option>
          {SERVICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select
          value={s.time_tier ?? ""}
          onChange={(e) =>
            onChange({ ...s, time_tier: (e.target.value || undefined) as TimeTier | undefined })
          }
          disabled={readOnly}
          className="w-20 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs"
        >
          <option value="">-</option>
          {TIER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[200px]" title={s.raw_text ?? ""}>
        {s.raw_text || "-"}
      </td>
      <td className="px-3 py-1.5 text-right">
        {typeof s.confidence === "number" && <ConfidenceBadge value={s.confidence} />}
      </td>
    </tr>
  )
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}
