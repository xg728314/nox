"use client"

/**
 * WorkLogModal — 스태프 1명의 cross_store_work_records (status='pending') 기록.
 *
 * Phase 10 P1 (2026-04-24) 방 중심 단순화:
 *   - 근무 가게 선택 → 방 dropdown → active session 자동 연결
 *   - session_id / business_day_id / UUID 수동 입력 UI 완전 제거
 *   - 방 라벨 / 금액 힌트 / 메모 / 종료시간 입력 제거
 *   - 종목 / 근무형태 / 시작시간 은 "참고 표시" — 현재 DB 저장 안 됨
 *     (정산 SSOT: room_sessions.started_at / 담당실장 / business_day_id)
 *   - 에러: route 가 반환한 error code 를 한글 매핑으로 번역, raw detail 은
 *     console 에만 남김.
 *
 * 서버 API:
 *   POST /api/staff-work-logs
 *     body: { hostess_membership_id, working_store_uuid, session_id,
 *             business_day_id }
 *   GET  /api/rooms/for-work-log?working_store_uuid=X
 *     → rooms[] with active_session_id + business_day_id
 *   GET  /api/stores?include_self=1
 *     → 매장 dropdown
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type Category = "public" | "shirt" | "hyper" | "etc"
type WorkType = "full" | "half" | "cha3" | "half_cha3"

const CATEGORY_LABEL: Record<Category, string> = {
  public: "퍼블릭",
  shirt: "셔츠",
  hyper: "하이퍼",
  etc: "기타",
}

const WORK_TYPE_LABEL: Record<WorkType, string> = {
  full: "완티",
  half: "반티",
  cha3: "차3",
  half_cha3: "반차3",
}

type Props = {
  open: boolean
  onClose: () => void
  hostessMembershipId: string
  hostessName: string
  callerStoreUuid: string
  onSuccess?: () => void
}

type StoreOption = { id: string; store_name: string }

type RoomOption = {
  room_uuid: string
  room_no: string
  room_name: string | null
  active_session_id: string | null
  business_day_id: string | null
  started_at: string | null
  ended_at: string | null
  manager_membership_id: string | null
  manager_name: string | null
  session_status: string | null
  customer_name_snapshot: string | null
}

type RoomsApiResponse = {
  working_store_uuid: string
  rooms: RoomOption[]
  scope?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── error code → 한글 매핑 ─────────────────────────────────
const ERROR_KO: Record<string, string> = {
  MISSING_FIELDS: "필수 정보가 누락되었습니다.",
  SESSION_STORE_MISMATCH: "선택한 방과 근무 가게 정보가 일치하지 않습니다.",
  BUSINESS_DAY_MISMATCH: "선택한 세션의 영업일 정보가 일치하지 않습니다.",
  SESSION_NOT_FOUND: "선택한 방의 세션을 찾을 수 없습니다.",
  WORKING_STORE_NOT_FOUND: "선택한 근무 가게를 찾을 수 없습니다.",
  ASSIGNMENT_FORBIDDEN: "담당 스태프만 근무등록할 수 있습니다.",
  STORE_SCOPE_FORBIDDEN: "내 소속 스태프만 등록할 수 있습니다.",
  HOSTESS_ROLE_INVALID: "스태프 멤버십이 유효하지 않습니다.",
  HOSTESS_NOT_FOUND: "스태프를 찾을 수 없습니다.",
  ROLE_FORBIDDEN: "근무 기록 권한이 없습니다.",
  INSERT_FAILED: "근무등록 저장에 실패했습니다.",
  BAD_REQUEST: "요청 형식이 올바르지 않습니다.",
  INTERNAL_ERROR: "서버 처리 중 오류가 발생했습니다.",
}

function resolveErrorMessage(
  code: string | undefined,
  fallback: string | undefined,
): string {
  if (code && ERROR_KO[code]) return ERROR_KO[code]
  // raw detail / PG 원문이 body.message 로 들어와도 UI 에 그대로 노출하지 않음.
  return fallback && !fallback.includes("violates") && !fallback.includes("does not exist")
    ? fallback
    : "근무등록에 실패했습니다."
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

export default function WorkLogModal({
  open,
  onClose,
  hostessMembershipId,
  hostessName,
  callerStoreUuid,
  onSuccess,
}: Props) {
  const [workingStoreUuid, setWorkingStoreUuid] = useState(callerStoreUuid)
  const [roomUuid, setRoomUuid] = useState<string>("")
  // 참고용 (현재 DB 저장 안 됨)
  const [category, setCategory] = useState<Category | "">("")
  const [workType, setWorkType] = useState<WorkType | "">("")

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Store picker
  const [stores, setStores] = useState<StoreOption[] | null>(null)
  const [storeLoadFailed, setStoreLoadFailed] = useState(false)

  // Rooms (working_store 기준)
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [roomsLoadFailed, setRoomsLoadFailed] = useState(false)

  // 매장 목록 로드
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/stores?include_self=1")
        if (!res.ok) {
          if (!cancelled) setStoreLoadFailed(true)
          return
        }
        const data = await res.json().catch(() => ({}))
        const arr = Array.isArray(data.stores) ? (data.stores as StoreOption[]) : []
        if (!cancelled) {
          if (arr.length === 0) setStoreLoadFailed(true)
          else setStores(arr)
        }
      } catch {
        if (!cancelled) setStoreLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // working_store 변경 → rooms 재로드 + roomUuid 초기화
  useEffect(() => {
    if (!open) return
    setRoomUuid("")
    const trimmed = workingStoreUuid.trim()
    if (!UUID_RE.test(trimmed)) {
      setRooms([])
      setRoomsLoadFailed(false)
      setRoomsLoading(false)
      return
    }
    let cancelled = false
    setRoomsLoading(true)
    setRoomsLoadFailed(false)
    ;(async () => {
      try {
        const res = await apiFetch(
          `/api/rooms/for-work-log?working_store_uuid=${encodeURIComponent(trimmed)}`,
        )
        if (!res.ok) {
          if (!cancelled) {
            setRoomsLoadFailed(true)
            setRooms([])
          }
          return
        }
        const data = (await res.json().catch(() => ({}))) as Partial<RoomsApiResponse>
        if (cancelled) return
        const list = Array.isArray(data.rooms) ? data.rooms : []
        setRooms(list)
      } catch {
        if (!cancelled) setRoomsLoadFailed(true)
      } finally {
        if (!cancelled) setRoomsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, workingStoreUuid])

  if (!open) return null

  const selectedRoom = rooms.find((r) => r.room_uuid === roomUuid) ?? null

  // Validation
  const workingStoreErr = !workingStoreUuid.trim()
    ? "근무 가게를 선택하세요."
    : !UUID_RE.test(workingStoreUuid.trim())
      ? "UUID 형식이 올바르지 않습니다."
      : ""
  const roomErr = !roomUuid
    ? "방을 선택하세요."
    : selectedRoom && !selectedRoom.active_session_id
      ? "이 방은 아직 열린 세션이 없습니다. 먼저 해당 방 세션을 생성해야 합니다."
      : ""

  const isSameStore =
    UUID_RE.test(workingStoreUuid.trim()) &&
    workingStoreUuid.trim() === callerStoreUuid

  const canSubmit = !workingStoreErr && !roomErr && !submitting

  function reset() {
    setWorkingStoreUuid(callerStoreUuid)
    setRoomUuid("")
    setCategory("")
    setWorkType("")
    setError("")
  }

  async function handleSubmit() {
    if (!canSubmit || !selectedRoom || !selectedRoom.active_session_id || !selectedRoom.business_day_id) {
      return
    }
    setError("")
    setSubmitting(true)
    try {
      const payload = {
        hostess_membership_id: hostessMembershipId,
        working_store_uuid: workingStoreUuid.trim(),
        session_id: selectedRoom.active_session_id,
        business_day_id: selectedRoom.business_day_id,
      }
      const res = await apiFetch("/api/staff-work-logs", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
        detail?: string
      }
      if (!res.ok) {
        // raw detail 은 console 로만; UI 에는 code→ko 매핑만.
        if (body.detail) {
          // eslint-disable-next-line no-console
          console.error("[staff-work-logs] code=%s detail=%s", body.error, body.detail)
        }
        setError(resolveErrorMessage(body.error, body.message))
        return
      }
      onSuccess?.()
      reset()
      onClose()
    } catch {
      setError(ERROR_KO.INTERNAL_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  const fieldErr = (msg: string) =>
    msg ? <p className="text-[10px] text-red-300 mt-1">{msg}</p> : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-pink-400/25 bg-[#0A1222] p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">근무 기록</div>
            <div className="text-base font-semibold text-pink-200">{hostessName}</div>
          </div>
          <button
            onClick={() => {
              reset()
              onClose()
            }}
            className="text-xs text-slate-400 hover:text-white"
          >
            닫기
          </button>
        </div>

        {/* same/cross 안내 */}
        {!isSameStore && UUID_RE.test(workingStoreUuid.trim()) && (
          <div className="rounded-xl border border-pink-400/30 bg-pink-500/10 px-3 py-2 text-[11px] text-pink-200">
            타매장 근무 기록 (cross-store 정산 편입 대상).
          </div>
        )}

        {/* 근무 가게 */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            근무 가게 <span className="text-red-400">*</span>
          </label>
          {stores && !storeLoadFailed ? (
            <select
              value={workingStoreUuid}
              onChange={(e) => setWorkingStoreUuid(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">매장 선택...</option>
              <option value={callerStoreUuid}>{"(본 매장)"}</option>
              {stores
                .filter((s) => s.id !== callerStoreUuid)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_name}
                  </option>
                ))}
            </select>
          ) : (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              매장 목록을 불러오지 못했습니다. 새로고침 후 재시도하세요.
            </div>
          )}
          {fieldErr(workingStoreErr)}
        </div>

        {/* 방 dropdown */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            방 <span className="text-red-400">*</span>
          </label>
          {roomsLoading ? (
            <div className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-500">
              방 목록 불러오는 중...
            </div>
          ) : rooms.length > 0 ? (
            <select
              value={roomUuid}
              onChange={(e) => setRoomUuid(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">방 선택...</option>
              {rooms.map((r) => {
                const hasSession = !!r.active_session_id
                const label = [
                  `${r.room_no}번방`,
                  hasSession
                    ? r.customer_name_snapshot
                      ? `(${r.customer_name_snapshot})`
                      : null
                    : "(세션 없음)",
                  hasSession ? fmtTime(r.started_at) : null,
                  hasSession && r.session_status === "active" ? "· 진행중" : null,
                  hasSession && r.session_status === "closed" ? "· 종료됨" : null,
                ]
                  .filter(Boolean)
                  .join(" ")
                return (
                  <option key={r.room_uuid} value={r.room_uuid}>
                    {label}
                  </option>
                )
              })}
            </select>
          ) : (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {roomsLoadFailed
                ? "방 목록 로드 실패. 새로고침 후 재시도하세요."
                : isSameStore
                  ? "이 매장에 열린/최근 종료 세션이 있는 방이 없습니다. 카운터에서 session 을 먼저 여세요."
                  : "본 매장 hostess 가 이 매장 세션에 아직 참여한 기록이 없습니다. 근무매장 카운터에서 session_participants 편입 후 재시도하세요."}
            </div>
          )}
          {fieldErr(roomErr)}
        </div>

        {/* 선택한 방 요약 (담당실장 / 시작시간 — session SSOT) */}
        {selectedRoom && selectedRoom.active_session_id && (
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 space-y-1">
            <div>
              근무시간 (기준):{" "}
              <b className="font-mono">{fmtTime(selectedRoom.started_at)}</b>
              {selectedRoom.ended_at && (
                <> ~ <b className="font-mono">{fmtTime(selectedRoom.ended_at)}</b></>
              )}
            </div>
            <div>
              방 담당실장: <b>{selectedRoom.manager_name ?? "(미지정)"}</b>
            </div>
            <div className="text-[10px] text-emerald-300/80">
              이 시간은 방 담당실장이 세션을 여닫을 때 기준이 됩니다. 정산/리포트의 SSOT.
            </div>
          </div>
        )}

        {/* 참고용 입력 (현재 DB 에 저장되지 않음) */}
        <div className="rounded-xl border border-slate-400/15 bg-slate-500/5 px-3 py-2 space-y-3">
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <span className="inline-block rounded bg-slate-500/20 px-1.5 py-0.5">참고용</span>
            <span>아래 정보는 현재 저장되지 않습니다 (세션 기준으로 정산 반영).</span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">종목</label>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c === category ? "" : c)}
                  className={`h-9 rounded-lg text-xs font-medium border transition-colors ${
                    category === c
                      ? "bg-pink-500/20 text-pink-200 border-pink-500/30"
                      : "bg-white/5 text-slate-400 border-white/10"
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">근무형태</label>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWorkType(w === workType ? "" : w)}
                  className={`h-9 rounded-lg text-xs font-medium border transition-colors ${
                    workType === w
                      ? "bg-purple-500/20 text-purple-200 border-purple-500/30"
                      : "bg-white/5 text-slate-400 border-white/10"
                  }`}
                >
                  {WORK_TYPE_LABEL[w]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={submitting}
            className="flex-1 h-11 rounded-xl bg-white/5 text-slate-300 text-sm border border-white/10 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 h-11 rounded-xl bg-pink-500/25 text-pink-100 text-sm font-medium border border-pink-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "저장 중..." : "근무 등록"}
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center">
          저장 직후 상태: <b>pending</b>. 확정은 사장/운영자가 수행합니다.
        </p>
      </div>
    </div>
  )
}
