"use client"

/**
 * LocationCorrectionSheet — 모바일 4-step 위저드.
 *
 * Step 1: 층 선택      (5/6/7/8)
 * Step 2: 매장 선택    (GET /api/monitor/stores?floor=N)
 * Step 3: 방 or zone   (선택 매장의 방 리스트 or counter/restroom/elevator/external)
 * Step 4: 유형 + 메모  (자동 분류 + 5종, 500자 메모)
 *
 * 저장 시:
 *   POST /api/location/correct
 *   → ok/deduplicated 분기 토스트
 *   → onSuccess() 호출(부모에서 refresh)
 *
 * 뒤로 이동 시 선택값 보존. 오조작 방지 2-step 최소 강제 (Step 1 → 4).
 *
 * mock 없음. 실 API 만 사용.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import {
  ERROR_TYPES, ERROR_TYPE_LABEL, type ErrorType,
} from "@/lib/location/errorTypes"

export type CorrectionTarget = {
  participant_id: string | null
  membership_id: string
  display_name: string
  /** detected 위치 정보(현재 시스템이 보는 곳). */
  detected: {
    store_uuid: string | null
    store_name: string | null
    room_uuid: string | null
    room_no: string | null
    zone: string | null
    floor: number | null
  }
}

type Props = {
  open: boolean
  target: CorrectionTarget | null
  onClose: () => void
  onSuccess: () => void
}

type Zone = "room" | "counter" | "restroom" | "elevator" | "external_floor"

const ZONE_OPTIONS: Array<{ value: Zone; label: string }> = [
  { value: "room", label: "방" },
  { value: "counter", label: "카운터" },
  { value: "restroom", label: "화장실" },
  { value: "elevator", label: "엘리베이터" },
  { value: "external_floor", label: "외부(타층)" },
]

type StoreEntry = { store_uuid: string; store_name: string; is_mine: boolean }
type RoomEntry = { room_uuid: string; room_name: string; floor_no: number | null }

export default function LocationCorrectionSheet({ open, target, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1 — floor
  const [floor, setFloor] = useState<number | null>(null)

  // Step 2 — store (fetched from /api/monitor/stores?floor=N)
  const [stores, setStores] = useState<StoreEntry[]>([])
  const [storesLoading, setStoresLoading] = useState(false)
  const [storesError, setStoresError] = useState<string | null>(null)
  const [storeUuid, setStoreUuid] = useState<string | null>(null)
  const [storeName, setStoreName] = useState<string | null>(null)

  // Step 3 — zone + room (rooms fetched from /api/monitor/scope?scope=store-<uuid>)
  const [rooms, setRooms] = useState<RoomEntry[]>([])
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [zone, setZone] = useState<Zone>("room")
  const [roomUuid, setRoomUuid] = useState<string | null>(null)

  // Step 4 — error_type + note
  const [errorType, setErrorType] = useState<"" | ErrorType>("")
  const [note, setNote] = useState("")

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<{ kind: "ok" | "info" | "err"; text: string } | null>(null)

  // Reset every time the sheet opens with a new target.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setFloor(target?.detected.floor ?? null)
    setStores([]); setStoresError(null); setStoreUuid(null); setStoreName(null)
    setRooms([]); setRoomsError(null); setZone("room"); setRoomUuid(null)
    setErrorType(""); setNote("")
    setMsg(null)
  }, [open, target?.participant_id, target?.membership_id])

  // Step 2: fetch stores on floor
  useEffect(() => {
    if (!open || step !== 2 || floor == null) return
    let cancelled = false
    const load = async () => {
      setStoresLoading(true); setStoresError(null); setStores([])
      try {
        const r = await apiFetch(`/api/monitor/stores?floor=${floor}`)
        if (cancelled) return
        if (r.status === 403) { setStoresError("403 — 이 층을 볼 권한이 없습니다."); return }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setStoresError(`${r.status} — ${b.message ?? b.error ?? "failed"}`)
          return
        }
        const json = await r.json() as { stores: StoreEntry[] }
        if (!cancelled) setStores(json.stores ?? [])
      } catch (e) {
        if (!cancelled) setStoresError(e instanceof Error ? e.message : "network error")
      } finally {
        if (!cancelled) setStoresLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, step, floor])

  // Step 3: fetch rooms for selected store
  useEffect(() => {
    if (!open || step !== 3 || !storeUuid) return
    let cancelled = false
    const load = async () => {
      setRoomsLoading(true); setRoomsError(null); setRooms([])
      try {
        const r = await apiFetch(`/api/monitor/scope?scope=store-${storeUuid}`)
        if (cancelled) return
        if (r.status === 403) { setRoomsError("403 — 이 매장을 볼 권한이 없습니다."); return }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setRoomsError(`${r.status} — ${b.message ?? b.error ?? "failed"}`)
          return
        }
        const json = await r.json() as { stores: Array<{ store_uuid: string; rooms: Array<{ room_uuid: string; room_name: string; floor_no: number | null }> }> }
        const s = json.stores?.find(x => x.store_uuid === storeUuid) ?? json.stores?.[0]
        if (!cancelled) setRooms(s?.rooms ?? [])
      } catch (e) {
        if (!cancelled) setRoomsError(e instanceof Error ? e.message : "network error")
      } finally {
        if (!cancelled) setRoomsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, step, storeUuid])

  const canSubmit = useMemo(() => {
    if (!target) return false
    if (zone === "room" && !roomUuid) return false
    if (!storeUuid) return false
    return true
  }, [target, zone, roomUuid, storeUuid])

  if (!open || !target) return null

  const submit = async () => {
    if (!canSubmit || !target) return
    setSubmitting(true); setMsg(null)
    try {
      const r = await apiFetch("/api/location/correct", {
        method: "POST",
        body: JSON.stringify({
          target_membership_id: target.membership_id,
          detected: {
            floor: target.detected.floor,
            store_uuid: target.detected.store_uuid,
            room_uuid: target.detected.room_uuid,
            zone: target.detected.zone ?? "unknown",
            at: null,
          },
          corrected: {
            floor,
            store_uuid: storeUuid,
            room_uuid: zone === "room" ? roomUuid : null,
            zone,
          },
          error_type: errorType === "" ? null : errorType,
          correction_note: note.trim() || null,
          participant_id: target.participant_id,
        }),
      })
      const body = await r.json().catch(() => ({})) as {
        ok?: boolean; deduplicated?: boolean
        error?: string; message?: string
        error_type?: string; existing_log_id?: string
      }
      if (!r.ok || !body.ok) {
        setMsg({ kind: "err", text: body.message ?? body.error ?? `수정 실패 (${r.status})` })
        return
      }
      if (body.deduplicated) {
        setMsg({ kind: "info", text: "이미 최근에 동일한 수정이 있습니다. 기존 기록 유지." })
        onSuccess()
        window.setTimeout(() => onClose(), 1400)
        return
      }
      setMsg({
        kind: "ok",
        text: `수정 완료${body.error_type ? ` (유형: ${ERROR_TYPE_LABEL[body.error_type as ErrorType] ?? body.error_type})` : ""}`,
      })
      onSuccess()
      window.setTimeout(() => onClose(), 800)
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "network error" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="위치 오류 수정">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        className="relative w-full bg-[#0b0e1c] border-t border-amber-500/30 rounded-t-2xl max-h-[90vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-100">위치 오류 수정</div>
            <div className="text-[10px] text-slate-500 truncate">
              {target.display_name} · Step {step}/4
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="닫기">×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Step 1 */}
          {step === 1 && (
            <section>
              <div className="text-[11px] text-slate-400 mb-2">실제로 위치한 층을 선택하세요.</div>
              <div className="grid grid-cols-4 gap-2">
                {[5, 6, 7, 8].map(f => (
                  <button
                    key={f}
                    onClick={() => setFloor(f)}
                    className={`py-3 rounded-lg text-[13px] font-bold border ${
                      floor === f
                        ? "bg-amber-500/20 border-amber-500/50 text-amber-100"
                        : "bg-white/[0.03] border-white/10 text-slate-300"
                    }`}
                  >
                    {f}F
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <section>
              <div className="text-[11px] text-slate-400 mb-2">{floor}층 매장을 선택하세요.</div>
              {storesLoading && <div className="text-slate-500 text-[12px] py-6 text-center">매장 로드 중…</div>}
              {storesError && (
                <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">⚠ {storesError}</div>
              )}
              {!storesLoading && !storesError && stores.length === 0 && (
                <div className="text-slate-500 text-[12px] py-6 text-center">{floor}층에 활성 매장이 없습니다.</div>
              )}
              {stores.length > 0 && (
                <ul className="space-y-1">
                  {stores.map(s => (
                    <li key={s.store_uuid}>
                      <button
                        onClick={() => { setStoreUuid(s.store_uuid); setStoreName(s.store_name) }}
                        className={`w-full text-left px-3 py-2 rounded-lg border ${
                          storeUuid === s.store_uuid
                            ? "bg-amber-500/10 border-amber-500/40 text-amber-100"
                            : s.is_mine
                              ? "bg-cyan-500/5 border-cyan-500/25 text-slate-200"
                              : "bg-white/[0.03] border-white/10 text-slate-200"
                        }`}
                      >
                        <span className="font-semibold">{s.store_name}</span>
                        {s.is_mine && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200">내 가게</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <section className="space-y-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-2">구체 위치를 선택하세요. (매장: {storeName ?? "?"})</div>
                <div className="grid grid-cols-5 gap-1">
                  {ZONE_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => { setZone(o.value); if (o.value !== "room") setRoomUuid(null) }}
                      className={`py-2 rounded-md text-[11px] font-semibold border ${
                        zone === o.value
                          ? "bg-amber-500/20 border-amber-500/50 text-amber-100"
                          : "bg-white/[0.03] border-white/10 text-slate-300"
                      }`}
                    >{o.label}</button>
                  ))}
                </div>
              </div>
              {zone === "room" && (
                <div>
                  <div className="text-[11px] text-slate-400 mb-1.5">방 선택</div>
                  {roomsLoading && <div className="text-slate-500 text-[12px] py-3 text-center">방 로드 중…</div>}
                  {roomsError && (
                    <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">⚠ {roomsError}</div>
                  )}
                  {!roomsLoading && !roomsError && rooms.length === 0 && (
                    <div className="text-slate-500 text-[12px] py-3 text-center">방 정보를 불러올 수 없습니다.</div>
                  )}
                  {rooms.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto">
                      {rooms.map(r => (
                        <button
                          key={r.room_uuid}
                          onClick={() => setRoomUuid(r.room_uuid)}
                          className={`px-2 py-2 rounded-md text-[11px] border ${
                            roomUuid === r.room_uuid
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-100"
                              : "bg-white/[0.03] border-white/10 text-slate-300"
                          }`}
                        >{r.room_name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <section className="space-y-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-1.5">오류 유형</div>
                <select
                  value={errorType}
                  onChange={e => setErrorType(e.target.value as "" | ErrorType)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-2 text-[12px] text-slate-100"
                >
                  <option value="">자동 분류</option>
                  {ERROR_TYPES.map(t => <option key={t} value={t}>{ERROR_TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-1.5">메모 (선택, ≤500자)</div>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="상황 설명이 필요하면 작성"
                  className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-[12px] text-slate-100"
                />
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                저장하면 검수 로그에 기록됩니다. 15초 내 동일 수정은 중복 방지로 차단됩니다.
              </div>
              {msg && (
                <div className={`text-[11px] rounded px-2 py-1 border ${
                  msg.kind === "ok"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                    : msg.kind === "info"
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-200"
                      : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}>{msg.text}</div>
              )}
            </section>
          )}
        </div>

        {/* Footer — back / next / submit */}
        <footer className="flex items-center justify-between gap-2 px-4 py-3 border-t border-white/[0.06]">
          <button
            onClick={() => { if (step > 1) setStep((step - 1) as 1 | 2 | 3 | 4) }}
            disabled={step === 1 || submitting}
            className="px-3 py-1.5 rounded-lg text-[12px] text-slate-300 bg-white/[0.04] border border-white/10 disabled:opacity-40"
          >뒤로</button>

          {step < 4 ? (
            <button
              onClick={() => {
                if (step === 1 && floor == null) return
                if (step === 2 && !storeUuid) return
                if (step === 3 && (zone === "room" && !roomUuid)) return
                setStep((step + 1) as 1 | 2 | 3 | 4)
              }}
              disabled={
                submitting ||
                (step === 1 && floor == null) ||
                (step === 2 && !storeUuid) ||
                (step === 3 && zone === "room" && !roomUuid)
              }
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-amber-100 bg-amber-500/20 border border-amber-500/50 disabled:opacity-40"
            >다음</button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={submitting || !canSubmit}
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-amber-100 bg-amber-500/25 border border-amber-500/60 disabled:opacity-40"
            >{submitting ? "저장 중…" : "저장"}</button>
          )}
        </footer>
      </div>
    </div>
  )
}
