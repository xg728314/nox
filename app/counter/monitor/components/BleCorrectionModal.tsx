"use client"

/**
 * BleCorrectionModal — human correction overlay UI.
 *
 * Operator selects the actual location for a worker when BLE has
 * misclassified them. POSTs to `/api/ble/corrections` which writes
 * exclusively to `ble_presence_corrections` — raw BLE tables, sessions,
 * participants, and settlement are never touched.
 *
 * Opened from ActionPopover's [위치 수정] button, rendered at page
 * level with higher z-index than the action popover so operators see
 * both the action context and the correction form.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { MonitorBlePresence, MonitorBleZone, MonitorRoom } from "../types"
import { BLE_ZONE_LABEL } from "./BleHint"
import {
  ERROR_TYPES,
  ERROR_TYPE_LABEL,
  type ErrorType,
} from "@/lib/location/errorTypes"

// Phase 2 — /api/location/correct 로 제출 경로 교체.
// 기존 /api/ble/corrections 는 외부 자동화 호환을 위해 유지한다.

export type CorrectionSubject = {
  participant_id: string | null
  membership_id: string
  room_uuid: string | null
  display_name: string
  /** Current zone from the monitor snapshot, used as `original_zone`
   *  in the correction payload. */
  original_zone: string
  /** Optional raw BLE presence row for this subject (used to show the
   *  "BLE가 말한 위치" line). */
  ble?: MonitorBlePresence | null
}

type Props = {
  open: boolean
  subject: CorrectionSubject | null
  rooms: MonitorRoom[]
  onClose: () => void
  onSuccess: () => void
}

type TargetZone = "room" | "counter" | "restroom" | "elevator" | "external_floor"

const ZONE_OPTIONS: Array<{ value: TargetZone; label: string }> = [
  { value: "room", label: "방" },
  { value: "counter", label: "카운터" },
  { value: "restroom", label: "화장실" },
  { value: "elevator", label: "엘리베이터" },
  { value: "external_floor", label: "외부(타층)" },
]

const REASON_OPTIONS = [
  "",
  "화장실 오탐",
  "카운터 오탐",
  "엘베 오탐",
  "타층 오탐",
  "복귀 반영 늦음",
  "기타",
]

type Status = "idle" | "working" | "ok" | "error"

export default function BleCorrectionModal({
  open, subject, rooms, onClose, onSuccess,
}: Props) {
  const [zone, setZone] = useState<TargetZone>("room")
  const [roomUuid, setRoomUuid] = useState<string | null>(null)
  const [reason, setReason] = useState<string>("")
  const [note, setNote] = useState<string>("")
  // Phase 2 추가: error_type 선택. "" 은 "자동 분류" 로 취급 — 서버에서
  // classifyErrorType() 으로 파생한다.
  const [errorType, setErrorType] = useState<"" | ErrorType>("")
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState<string>("")

  // Reset transient UI every time the subject changes.
  useEffect(() => {
    if (!subject) return
    setZone("room")
    setRoomUuid(subject.room_uuid ?? rooms[0]?.room_uuid ?? null)
    setReason("")
    setNote("")
    setErrorType("")
    setStatus("idle")
    setMessage("")
  }, [subject?.participant_id, subject?.membership_id, rooms.length])

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => {
      if ((a.floor_no ?? 0) !== (b.floor_no ?? 0)) return (a.floor_no ?? 0) - (b.floor_no ?? 0)
      return a.sort_order - b.sort_order
    }),
    [rooms],
  )

  if (!open || !subject) return null

  const currentLocation = (() => {
    if (subject.ble) {
      const z = BLE_ZONE_LABEL[subject.ble.zone as MonitorBleZone] ?? subject.ble.zone
      const room = subject.ble.room_uuid
        ? rooms.find(r => r.room_uuid === subject.ble!.room_uuid)?.room_name ?? null
        : null
      return room ? `${z} · ${room}` : z
    }
    if (subject.room_uuid) {
      const r = rooms.find(x => x.room_uuid === subject.room_uuid)
      return r ? `방 · ${r.room_name}` : "방"
    }
    return subject.original_zone || "알 수 없음"
  })()

  const submit = async () => {
    if (!subject) return
    if (zone === "room" && !roomUuid) {
      setStatus("error")
      setMessage("corrected_room_uuid 가 필요합니다. 방을 선택해주세요.")
      return
    }
    setStatus("working")
    setMessage("")
    try {
      // Phase 2: 신 엔드포인트로 제출.
      //   - error_type 가 "" 면 서버 classifyErrorType() 로 자동 파생.
      //   - detected.zone / room_uuid 는 subject.original_zone / BLE snapshot
      //     에서 전달.
      //   - corrected.store_uuid 는 생략. 서버가 corrected_room_uuid 에서
      //     파생하거나 caller 의 auth.store_uuid 를 사용.
      //   - Ops 이 모달은 caller 자기 매장 범위에서만 열리므로 cross-store
      //     전송은 애초에 발생하지 않는다 (super_admin UI 는 별도).
      const correctedRoom =
        zone === "room" ? rooms.find(r => r.room_uuid === roomUuid) ?? null : null

      const r = await apiFetch("/api/location/correct", {
        method: "POST",
        body: JSON.stringify({
          target_membership_id: subject.membership_id,
          detected: {
            floor: null,
            store_uuid: null,
            room_uuid: subject.ble?.room_uuid ?? subject.room_uuid ?? null,
            zone: subject.original_zone || null,
            at: subject.ble?.last_seen_at ?? null,
          },
          corrected: {
            floor: correctedRoom?.floor_no ?? null,
            // store_uuid 는 서버가 room 에서 파생
            room_uuid: zone === "room" ? roomUuid : null,
            zone,
          },
          // 빈 문자열은 서버에서 "자동 분류" 로 해석
          error_type: errorType === "" ? null : errorType,
          correction_note: note.trim() || null,
          session_id: null,
          participant_id: subject.participant_id,
          reason: reason || null,
        }),
      })
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        deduplicated?: boolean
        existing_log_id?: string | null
        error?: string
        message?: string
        error_type?: string
      }
      if (!r.ok || !body.ok) {
        setStatus("error")
        setMessage(body.message ?? body.error ?? "수정 실패")
        return
      }
      setStatus("ok")
      if (body.deduplicated) {
        // 같은 대상·위치가 15초 내 이미 기록되었음 — 정상 흐름으로 안내.
        setMessage("이미 최근에 동일한 수정이 기록되어 있습니다 (15초 내 중복 방지). 기존 기록 유지.")
        onSuccess()
        window.setTimeout(() => onClose(), 1400)
        return
      }
      setMessage(
        body.error_type
          ? `위치 수정 기록 완료 — 유형: ${ERROR_TYPE_LABEL[body.error_type as ErrorType] ?? body.error_type}`
          : "위치 수정 기록 완료 — 다음 갱신에 반영됩니다.",
      )
      onSuccess()
      window.setTimeout(() => onClose(), 700)
    } catch (e) {
      setStatus("error")
      setMessage(e instanceof Error ? e.message : "네트워크 오류")
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="BLE 위치 수정"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-sm rounded-2xl bg-[#0b0e1c] border border-amber-500/30 shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-100">위치 수정</div>
            <div className="text-[10px] text-slate-500 truncate">
              {subject.display_name} · 현재: <span className="text-slate-300">{currentLocation}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none flex-shrink-0"
            aria-label="닫기"
          >×</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-[11px] text-slate-400 font-semibold mb-1.5">실제 위치</div>
            <div className="grid grid-cols-5 gap-1">
              {ZONE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setZone(o.value)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all ${
                    zone === o.value
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-100"
                      : "bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06]"
                  }`}
                >{o.label}</button>
              ))}
            </div>
          </div>

          {zone === "room" && (
            <div>
              <div className="text-[11px] text-slate-400 font-semibold mb-1.5">방 선택</div>
              <select
                value={roomUuid ?? ""}
                onChange={e => setRoomUuid(e.target.value || null)}
                className="w-full rounded-md bg-white/[0.04] border border-white/10 px-2 py-1.5 text-[12px] text-slate-100"
              >
                {sortedRooms.length === 0 && (
                  <option value="">선택 가능한 방이 없습니다</option>
                )}
                {sortedRooms.map(r => (
                  <option key={r.room_uuid} value={r.room_uuid}>
                    {r.floor_no ? `${r.floor_no}F · ` : ""}{r.room_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Phase 2 추가: 오류 유형 — "" 은 "자동 분류" */}
          <div>
            <div className="text-[11px] text-slate-400 font-semibold mb-1.5">오류 유형</div>
            <select
              value={errorType}
              onChange={e => setErrorType(e.target.value as "" | ErrorType)}
              className="w-full rounded-md bg-white/[0.04] border border-white/10 px-2 py-1.5 text-[12px] text-slate-100"
            >
              <option value="">자동 분류</option>
              {ERROR_TYPES.map(t => (
                <option key={t} value={t}>{ERROR_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[11px] text-slate-400 font-semibold mb-1.5">사유 (선택)</div>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full rounded-md bg-white/[0.04] border border-white/10 px-2 py-1.5 text-[12px] text-slate-100"
            >
              {REASON_OPTIONS.map((r, idx) => (
                <option key={idx} value={r}>{r === "" ? "— 선택 안 함 —" : r}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[11px] text-slate-400 font-semibold mb-1.5">메모 (선택)</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="추가 설명이 필요하면 작성"
              className="w-full rounded-md bg-white/[0.04] border border-white/10 px-2 py-1.5 text-[12px] text-slate-100 leading-snug"
            />
          </div>

          {message && (
            <div
              className={`text-[11px] ${
                status === "error" ? "text-red-300" :
                status === "ok" ? "text-emerald-300" :
                "text-slate-400"
              }`}
            >
              {message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            disabled={status === "working"}
            className="px-3 py-1.5 rounded-lg text-[12px] text-slate-300 hover:bg-white/[0.05] disabled:opacity-40"
          >취소</button>
          <button
            type="button"
            onClick={submit}
            disabled={status === "working" || (zone === "room" && !roomUuid)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-amber-100 bg-amber-500/20 border border-amber-500/50 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >{status === "working" ? "저장 중…" : "저장"}</button>
        </div>

        <div className="px-5 pb-4 text-[10px] text-slate-500 leading-snug">
          이 기록은 BLE 원본 데이터를 바꾸지 않습니다. 모니터 화면 표시에만 반영되며, 분석용 이력으로 남습니다.
        </div>
      </div>
    </div>
  )
}
