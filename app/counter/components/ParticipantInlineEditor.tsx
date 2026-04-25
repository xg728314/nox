"use client"

/**
 * ParticipantInlineEditor — row 1/2 표시값 자체를 클릭해서 바로 수정할
 * 수 있도록 하는 단일 공용 bottom-sheet popover.
 *
 * 5개 모드:
 *   - manager  : 담당 실장 교체 (origin_store 기준 매니저 목록 fetch)
 *   - store    : 소속 매장 교체 (STORES 상수 사용, 매니저는 자동 clear)
 *   - entered  : 입실 시각 재설정 (HH:MM, 오늘 날짜 기준)
 *   - count    : 종목 "N개" 증감 (time_minutes = N × unitMinutes)
 *   - end      : 종료 시각 재설정 → Δ(end - entered) → time_minutes
 *
 * 서버 계산 규칙은 그대로 유지. PATCH는 모두 fillUnspecified dispatch
 * 브랜치(`membership_id`를 body에 포함)를 통해 라우트의 기존 서버-권위
 * pricing/validation 파이프를 재사용한다. 클라이언트는 time_minutes /
 * manager_membership_id / origin_store_uuid / entered_at 만 보내고, 가격과
 * cha3/banti 같은 파생값은 서버가 다시 계산한다.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { STORES, CATEGORIES, type StaffItem, type Participant } from "../types"
import { unitMinutesFor } from "../helpers/categoryRegistry"

export type InlineEditMode = "manager" | "store" | "entered" | "count" | "end"

export type InlineEditCommit = {
  patch: Record<string, unknown>
  // UI 라벨용 — 저장 후 에러/토스트에 참고.
  summary: string
}

type Props = {
  open: boolean
  mode: InlineEditMode | null
  participant: Participant | null
  /** 카운터를 쓰는 내 매장 uuid — cross-store 여부 판단용 */
  currentStoreUuid: string | null
  /** 카운터 소속 매장 이름 — origin_store_name 이 없을 때 매니저 목록 조회용 */
  currentStoreName: string | null
  busy: boolean
  onClose: () => void
  onCommit: (payload: InlineEditCommit) => Promise<void>
}

const won = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("ko-KR") + "원"

function toLocalHHMM(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * HH:MM + 기준 Date → 같은 날짜의 해당 시각 ISO. 자정 경계에서 혼선이
 * 없도록 기준 Date의 year/month/day를 우선 사용한다.
 */
function composeIsoFromHHMM(hhmm: string, ref: Date): string {
  const [hh, mm] = hhmm.split(":").map(n => Number(n))
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return new Date().toISOString()
  const d = new Date(ref.getTime())
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

export default function ParticipantInlineEditor({
  open,
  mode,
  participant,
  currentStoreUuid,
  currentStoreName,
  busy,
  onClose,
  onCommit,
}: Props) {
  // manager mode
  const [managerList, setManagerList] = useState<StaffItem[]>([])
  const [selectedManager, setSelectedManager] = useState<{ membership_id: string; name: string } | null>(null)
  const [loadingMgrs, setLoadingMgrs] = useState(false)

  // store mode
  const [pickedStoreUuid, setPickedStoreUuid] = useState<string | null>(null)
  const [storeOptions, setStoreOptions] = useState<Array<{ id: string; store_name: string; floor: number | null }>>([])
  const [loadingStores, setLoadingStores] = useState(false)

  // entered / end mode
  const [hhmm, setHhmm] = useState<string>("")

  // count mode
  const [targetMinutes, setTargetMinutes] = useState<number>(0)

  const [error, setError] = useState("")

  const unitMinutes = useMemo(() => unitMinutesFor(participant?.category), [participant])

  const refCategory = participant?.category ?? CATEGORIES[0].name
  const currentTicketCount = useMemo(() => {
    if (!participant?.time_minutes || participant.time_minutes <= 0) return 0
    return Math.max(1, Math.round(participant.time_minutes / unitMinutes))
  }, [participant, unitMinutes])

  // ── mode 전환 시 상태 초기화 ────────────────────────────────────
  useEffect(() => {
    if (!open || !mode || !participant) return
    setError("")
    if (mode === "manager") {
      setSelectedManager(
        participant.manager_membership_id
          ? { membership_id: participant.manager_membership_id, name: participant.manager_name ?? "" }
          : null
      )
      // 매니저 목록 로드 — origin 이 있으면 origin 매장, 없으면 현재 매장.
      setManagerList([])
      setLoadingMgrs(true)
      ;(async () => {
        try {
          const storeName = participant.origin_store_name?.trim() || currentStoreName || ""
          const url = storeName
            ? `/api/store/staff?role=manager&store_name=${encodeURIComponent(storeName)}`
            : "/api/store/staff?role=manager"
          const res = await apiFetch(url)
          if (res.ok) {
            const d = await res.json()
            setManagerList((d.staff ?? []) as StaffItem[])
          }
        } catch { /* ignore */ }
        finally { setLoadingMgrs(false) }
      })()
    }
    if (mode === "store") {
      setPickedStoreUuid(participant.origin_store_uuid ?? currentStoreUuid)
      // /api/stores 은 owner-only. manager role fallback: types.ts STORES
      // 하드코딩 리스트에서 uuid 매핑이 없어서 manager picker 없이 이름만
      // 보여줘도 서버가 origin_store_uuid 로 받기 때문에, 실제 uuid가 꼭
      // 있어야 한다. 그래서 fetch 시도 후 403이면 fallback 경고만 노출.
      setStoreOptions([])
      setLoadingStores(true)
      ;(async () => {
        try {
          const res = await apiFetch("/api/stores?include_self=1")
          if (res.ok) {
            const d = await res.json()
            setStoreOptions((d.stores ?? []) as typeof storeOptions)
          }
        } catch { /* ignore */ }
        finally { setLoadingStores(false) }
      })()
    }
    if (mode === "entered") {
      setHhmm(toLocalHHMM(participant.entered_at))
    }
    if (mode === "count") {
      setTargetMinutes(Math.max(unitMinutes, participant.time_minutes || unitMinutes))
    }
    if (mode === "end") {
      // 종료 시각 = entered_at + time_minutes 분
      const base = participant.entered_at ? new Date(participant.entered_at).getTime() : Date.now()
      const endMs = base + (participant.time_minutes || 0) * 60000
      setHhmm(toLocalHHMM(new Date(endMs).toISOString()))
    }
    // 2026-04-24 P1 fix: 이전에는 `[open, mode, participant?.id]` 만 deps.
    //   같은 참여자의 entered_at / time_minutes 가 서버 동기화로 바뀌어도
    //   editor 가 stale 값으로 열려 잘못된 값 저장 위험. 관련 필드 포함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, participant?.id, participant?.entered_at, participant?.time_minutes, unitMinutes])

  if (!open || !mode || !participant) return null

  const title =
    mode === "manager" ? "실장 선택" :
    mode === "store"   ? "소속 매장 선택" :
    mode === "entered" ? "입실 시각 수정" :
    mode === "count"   ? "개수 조정" :
                          "종료 시각 수정"

  async function submit() {
    if (busy || !participant || !mode) return
    setError("")

    // 각 모드별 patch body 구성 — 모두 fillUnspecified dispatch를 트리거
    // (membership_id 키가 body에 포함되면 dispatch가 fillUnspecified로 라우팅).
    const body: Record<string, unknown> = { membership_id: null }
    let summary = ""

    if (mode === "manager") {
      if (!selectedManager) { setError("실장을 선택하세요."); return }
      body.manager_membership_id = selectedManager.membership_id
      summary = `실장 → ${selectedManager.name}`
    } else if (mode === "store") {
      if (!pickedStoreUuid) { setError("매장을 선택하세요."); return }
      // 가게 변경 시 기존 manager는 자동 해제 (새 매장의 실장과 자동으로
      // 호환되지 않을 가능성이 크므로 명시적으로 null 을 보낸다. 운영자는
      // 직후 manager 편집 UI에서 새 매장 실장을 고르면 된다).
      if (pickedStoreUuid === currentStoreUuid) {
        body.origin_store_uuid = null as unknown as string
      } else {
        body.origin_store_uuid = pickedStoreUuid
      }
      body.manager_membership_id = null
      const name = storeOptions.find(s => s.id === pickedStoreUuid)?.store_name
        ?? STORES.find(() => false)?.name // placeholder to keep types narrow
        ?? "매장 변경"
      summary = `소속 매장 → ${name}`
    } else if (mode === "entered") {
      if (!hhmm) { setError("시각을 입력하세요."); return }
      const ref = participant.entered_at ? new Date(participant.entered_at) : new Date()
      body.entered_at = composeIsoFromHHMM(hhmm, ref)
      summary = `입실 시각 → ${hhmm}`
    } else if (mode === "count") {
      if (!(targetMinutes >= unitMinutes)) {
        setError(`최소 ${unitMinutes}분 (1개) 이상이어야 합니다.`)
        return
      }
      body.time_minutes = targetMinutes
      summary = `개수 → ${Math.round(targetMinutes / unitMinutes)}개 (${targetMinutes}분)`
    } else if (mode === "end") {
      if (!hhmm) { setError("종료 시각을 입력하세요."); return }
      const ref = participant.entered_at ? new Date(participant.entered_at) : new Date()
      const enteredMs = ref.getTime()
      const endIso = composeIsoFromHHMM(hhmm, ref)
      let endMs = new Date(endIso).getTime()
      // 입실 이전으로 내려간 경우 다음날로 해석 (야간 경계).
      if (endMs <= enteredMs) endMs += 24 * 60 * 60 * 1000
      const minutes = Math.max(1, Math.round((endMs - enteredMs) / 60000))
      body.time_minutes = minutes
      summary = `종료 → ${hhmm} (${minutes}분)`
    }

    try {
      await onCommit({ patch: body, summary })
    } catch (e) {
      setError((e as Error).message || "저장 실패")
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => !busy && onClose()} />
      <div className="fixed left-0 right-0 bottom-0 z-[61] bg-[#1c1c2e] rounded-t-2xl p-4 max-h-[65vh] overflow-y-auto border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]">
        {busy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1c1c2e]/80 backdrop-blur-sm rounded-t-2xl">
            <div className="w-10 h-10 rounded-full border-[3px] border-cyan-400/30 border-t-cyan-400 animate-spin mb-3" />
            <span className="text-sm text-cyan-300">저장 중...</span>
          </div>
        )}
        <div className="mx-auto w-10 h-1 rounded-full bg-white/20 mb-4" />

        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-bold">{title}</div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* ── mode 별 본문 ─────────────────────────────────────────── */}

        {mode === "manager" && (
          <>
            <div className="text-[11px] text-slate-400 mb-2">
              기준 매장: <span className="text-slate-200">{participant.origin_store_name || currentStoreName || "-"}</span>
            </div>
            {loadingMgrs ? (
              <div className="py-6 text-center text-xs text-slate-500 animate-pulse">불러오는 중...</div>
            ) : managerList.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">등록된 실장이 없습니다.</div>
            ) : (
              <div className="space-y-2 mb-3 max-h-[40vh] overflow-y-auto">
                {managerList.map(m => (
                  <button
                    key={m.membership_id}
                    onClick={() => setSelectedManager({ membership_id: m.membership_id, name: m.name })}
                    className={`w-full flex items-center gap-3 h-12 rounded-xl border px-3 transition-all ${
                      selectedManager?.membership_id === m.membership_id
                        ? "bg-purple-500/20 border-purple-500/40 text-purple-200"
                        : "bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-200"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400/40 to-indigo-500/40 flex items-center justify-center text-xs font-bold">
                      {m.name.charAt(0)}
                    </div>
                    <span className="text-sm font-medium flex-1 text-left">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {mode === "store" && (
          <>
            <div className="text-[11px] text-slate-400 mb-2">
              가게를 바꾸면 기존 실장은 자동으로 해제됩니다.
            </div>
            {loadingStores ? (
              <div className="py-6 text-center text-xs text-slate-500 animate-pulse">불러오는 중...</div>
            ) : storeOptions.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {storeOptions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setPickedStoreUuid(s.id)}
                    className={`h-14 rounded-xl border transition-all flex flex-col items-center justify-center ${
                      pickedStoreUuid === s.id
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-200"
                        : "bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-200"
                    }`}
                  >
                    <span className="text-xs font-semibold">{s.store_name}</span>
                    {s.floor != null && <span className="text-[9px] text-slate-500 mt-0.5">{s.floor}층</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500 mb-3">
                매장 목록을 불러올 수 없습니다. (권한 없음)
              </div>
            )}
          </>
        )}

        {mode === "entered" && (
          <div className="mb-4">
            <label className="block text-[11px] text-slate-400 mb-1">입실 시각</label>
            <input
              type="time"
              value={hhmm}
              onChange={(e) => setHhmm(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              기존: {toLocalHHMM(participant.entered_at) || "-"}
            </div>
          </div>
        )}

        {mode === "count" && (
          <div className="mb-3">
            <div className="text-[11px] text-slate-400 mb-2">
              {refCategory} (1개 = {unitMinutes}분)
            </div>
            <div className="flex items-center justify-between bg-white/[0.04] border border-white/10 rounded-xl px-3 py-4">
              <button
                onClick={() => setTargetMinutes(m => Math.max(unitMinutes, m - unitMinutes))}
                disabled={targetMinutes <= unitMinutes}
                className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-30 text-white text-2xl font-bold"
              >−</button>
              <div className="flex flex-col items-center">
                <div className="text-2xl font-bold text-white">
                  {Math.round(targetMinutes / unitMinutes)}개
                </div>
                <div className="text-[11px] text-slate-500">{targetMinutes}분</div>
              </div>
              <button
                onClick={() => setTargetMinutes(m => m + unitMinutes)}
                className="w-12 h-12 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-2xl font-bold"
              >＋</button>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              기존: {currentTicketCount}개 ({participant.time_minutes}분)
            </div>
          </div>
        )}

        {mode === "end" && (
          <div className="mb-4">
            <label className="block text-[11px] text-slate-400 mb-1">종료 시각</label>
            <input
              type="time"
              value={hhmm}
              onChange={(e) => setHhmm(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              입실 {toLocalHHMM(participant.entered_at) || "-"} · 현재 {won(Number(participant.price_amount) || 0)}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-white/5 text-slate-300 text-sm hover:bg-white/10 disabled:opacity-50"
          >취소</button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-white text-sm font-semibold disabled:opacity-60"
          >저장</button>
        </div>
      </div>
    </>
  )
}
