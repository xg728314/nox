"use client"

/**
 * useParticipantEditFlow — CounterPageV2에 박혀있던 4개 핸들러를
 *   (ensureSession, handleInlineCommit, handleSheetCommit, bulkAssignManager)
 * 단일 훅으로 분리한 것. 동작 변경 없음 — 기존 body/메시지/refetch 순서
 * 모두 그대로.
 *
 * 비즈니스 로직 전용 훅이라 UI state 자체는 useCounterModals가 들고 있고,
 * 이 훅은 필요한 setter/state만 deps 로 받는다. service layer(counterApi)
 * 경유로 서버 호출.
 */

import type { Dispatch, SetStateAction } from "react"
import type { FocusData, SheetState } from "../types"
import { SHEET_INIT } from "../types"
import * as counterApi from "../services/counterApi"
import type { InlineEditCommit } from "../components/ParticipantInlineEditor"
import type { BulkMgrState, InlineEditState } from "./useCounterModals"

type Deps = {
  // focus / refetch
  focusData: FocusData | null
  setFocusData: Dispatch<SetStateAction<FocusData | null>>
  fetchRooms: () => Promise<void>
  fetchFocusData: (roomId: string, sessionId: string, startedAt: string) => Promise<void>
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>

  // modals (owned by useCounterModals)
  sheet: SheetState
  setSheet: Dispatch<SetStateAction<SheetState>>
  patchSheet: (p: Partial<SheetState>) => void
  bulkMgr: BulkMgrState
  setBulkMgr: Dispatch<SetStateAction<BulkMgrState>>
  inlineEdit: InlineEditState
  setInlineEdit: Dispatch<SetStateAction<InlineEditState>>

  // context
  currentStoreUuid: string | null
}

export type ParticipantEditFlow = {
  ensureSession: (roomId: string) => Promise<string | null>
  handleInlineCommit: (payload: InlineEditCommit) => Promise<void>
  handleSheetCommit: () => Promise<void>
  bulkAssignManager: (manager: { membership_id: string; name: string }) => Promise<void>
}

export function useParticipantEditFlow(deps: Deps): ParticipantEditFlow {
  // ─── ensureSession ───────────────────────────────────────────────
  // P0 fix: room-mismatch guard + stale-closure guard.
  // 2026-04-25 fix: 체크인 시도 전에 먼저 /api/rooms 스냅샷 으로 active 세션
  //   있는지 확인. 있으면 그대로 사용 → 409 SESSION_CONFLICT 네트워크 에러
  //   로그를 안 남김. 없을 때만 실제 checkin 호출.
  async function ensureSession(roomId: string): Promise<string | null> {
    const { focusData, setFocusData, fetchRooms, fetchFocusData, setError } = deps
    if (focusData?.roomId === roomId && focusData?.sessionId) {
      return focusData.sessionId
    }

    async function fetchActiveSessionForRoom(rid: string): Promise<
      | { sessionId: string; startedAt: string }
      | null
    > {
      try {
        const list = await counterApi.fetchRoomsSnapshot()
        if (!list) return null
        const match = list.find(x => x.id === rid)
        if (match?.session?.id) {
          return {
            sessionId: match.session.id,
            startedAt: match.session.started_at ?? "",
          }
        }
        return null
      } catch {
        return null
      }
    }

    // STEP 1: 선제 조회 — 이미 active 세션이 있으면 checkin 호출을 아예 안 함.
    const existing = await fetchActiveSessionForRoom(roomId)
    if (existing) {
      setFocusData({
        roomId,
        sessionId: existing.sessionId,
        started_at: existing.startedAt,
        session_status: "active",
        participants: [],
        orders: [],
        loading: true,
      })
      await fetchFocusData(roomId, existing.sessionId, existing.startedAt)
      return existing.sessionId
    }

    // STEP 2: 정말 없을 때만 체크인.
    try {
      const result = await counterApi.checkinSession(roomId)
      const res = { status: result.status, ok: result.ok }
      const data = result.data as { session_id?: string; started_at?: string; message?: string }

      if (res.status === 409) {
        // race: 방금 사이에 다른 단말이 체크인 했을 수도. 한 번 더 조회 후 사용.
        console.log("[ensureSession] 409 race — refetching fresh session")
        const fresh = await fetchActiveSessionForRoom(roomId)
        void fetchRooms()
        if (fresh) {
          setFocusData({
            roomId,
            sessionId: fresh.sessionId,
            started_at: fresh.startedAt,
            session_status: "active",
            participants: [],
            orders: [],
            loading: true,
          })
          await fetchFocusData(roomId, fresh.sessionId, fresh.startedAt)
          return fresh.sessionId
        }
        setError("기존 세션을 찾을 수 없습니다. 새로고침 해주세요.")
        return null
      }

      if (!res.ok) {
        console.error("[ensureSession] checkin failed:", res.status, data)
        setError(data.message || `체크인 실패 (${res.status})`)
        return null
      }

      const sid = data.session_id as string
      if (!sid) {
        console.error("[ensureSession] checkin response missing session_id:", data)
        setError("세션 생성 응답에 session_id가 없습니다.")
        return null
      }

      const sa = data.started_at as string
      setFocusData({
        roomId, sessionId: sid, started_at: sa,
        session_status: "active", participants: [], orders: [], loading: true,
      })
      // 2026-05-01 R-Counter-Speed: focus + rooms 병렬 fetch.
      await Promise.all([fetchFocusData(roomId, sid, sa), fetchRooms()])
      return sid
    } catch (err) {
      console.error("[ensureSession] unexpected error:", err)
      setError("세션 생성 실패")
      return null
    }
  }

  // ─── handleInlineCommit ──────────────────────────────────────────
  async function handleInlineCommit(payload: InlineEditCommit): Promise<void> {
    const { inlineEdit, setInlineEdit, fetchRooms, fetchFocusData, focusData, setError } = deps
    const target = inlineEdit
    if (!target) return
    setInlineEdit(s => s ? { ...s, busy: true } : s)
    setError("")
    try {
      const result = await counterApi.patchParticipant(target.participantId, payload.patch)
      const data = result.data as { message?: string }
      if (!result.ok) {
        const msg = typeof data?.message === "string" ? data.message : `저장 실패 (${result.status})`
        setError(`${payload.summary}: ${msg}`)
        setInlineEdit(s => s ? { ...s, busy: false } : s)
        throw new Error(msg)
      }
      // 2026-05-01 R-Counter-Speed: await 제거.
      void fetchRooms()
      if (focusData?.roomId && focusData?.sessionId) {
        void fetchFocusData(focusData.roomId, focusData.sessionId, focusData.started_at)
      }
      setInlineEdit(null)
    } catch (e) {
      setInlineEdit(s => s ? { ...s, busy: false } : s)
      throw e
    }
  }

  // ─── handleSheetCommit ───────────────────────────────────────────
  async function handleSheetCommit(): Promise<void> {
    const {
      sheet, setSheet, patchSheet, focusData, setFocusData, fetchRooms, fetchFocusData,
      setError, currentStoreUuid,
    } = deps
    if (!sheet.participantId || !sheet.category || sheet.timeMinutes === null) return
    patchSheet({ loading: true })
    setError("")
    try {
      const existingP = focusData?.participants.find(p => p.id === sheet.participantId)
      const isReEdit = !!(existingP?.category && existingP?.time_minutes)

      const body: Record<string, unknown> = {
        membership_id: null,
        category: sheet.category,
        time_minutes: sheet.timeMinutes,
        ...(isReEdit ? {} : { entered_at: new Date().toISOString() }),
      }
      if (typeof sheet.storeUuid === "string" && sheet.storeUuid.length > 0) {
        body.origin_store_uuid =
          sheet.storeUuid === currentStoreUuid ? null : sheet.storeUuid
      }
      if (sheet.manager) {
        body.manager_membership_id = sheet.manager.membership_id
      }
      const result = await counterApi.patchParticipant(sheet.participantId, body)
      const data = result.data as { message?: string }
      if (!result.ok) { setError(data.message || "업데이트 실패"); return }

      // 2026-05-01 R-Counter-Speed: Optimistic update — 에디터 즉시 반영.
      const targetId = sheet.participantId
      const newCategory = sheet.category
      const newTime = sheet.timeMinutes
      const newOriginStoreUuid =
        typeof sheet.storeUuid === "string" && sheet.storeUuid.length > 0
          ? (sheet.storeUuid === currentStoreUuid ? null : sheet.storeUuid)
          : undefined
      const newManagerId = sheet.manager?.membership_id ?? undefined
      const newManagerName = sheet.manager?.name ?? undefined
      setFocusData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          participants: prev.participants.map((p) =>
            p.id === targetId
              ? {
                  ...p,
                  category: newCategory,
                  time_minutes: newTime,
                  ...(newOriginStoreUuid !== undefined ? { origin_store_uuid: newOriginStoreUuid } : {}),
                  ...(newManagerId !== undefined ? { manager_membership_id: newManagerId } : {}),
                  ...(newManagerName !== undefined ? { manager_name: newManagerName } : {}),
                  ...(isReEdit ? {} : { entered_at: new Date().toISOString() }),
                }
              : p
          ),
        }
      })

      setSheet(SHEET_INIT)
      // Background refetch — server 가 price_amount 등 server-side 계산 결과 sync.
      void fetchRooms()
      if (focusData?.roomId && focusData?.sessionId) {
        void fetchFocusData(focusData.roomId, focusData.sessionId, focusData.started_at)
      }
    } catch { setError("요청 오류") }
    finally { patchSheet({ loading: false }) }
  }

  // ─── bulkAssignManager ───────────────────────────────────────────
  async function bulkAssignManager(
    manager: { membership_id: string; name: string },
  ): Promise<void> {
    const { bulkMgr, setBulkMgr, fetchRooms, fetchFocusData, focusData } = deps
    const { participantIds, roomId, sessionId } = bulkMgr
    if (participantIds.length === 0) return
    setBulkMgr(s => ({ ...s, busy: true }))
    try {
      await Promise.all(
        participantIds.map(pid =>
          counterApi.patchParticipant(pid, {
            membership_id: null,
            manager_membership_id: manager.membership_id,
          }).catch(() => null)
        )
      )
      // 2026-05-01 R-Counter-Speed: await 제거. realtime 자동 sync.
      void fetchRooms()
      if (roomId && sessionId) {
        const sa = focusData?.sessionId === sessionId ? focusData.started_at : ""
        void fetchFocusData(roomId, sessionId, sa ?? "")
      }
    } finally {
      setBulkMgr({
        open: false, storeName: "", storeUuid: null, managerList: [],
        participantIds: [], roomId: null, sessionId: null, busy: false,
      })
    }
  }

  return {
    ensureSession,
    handleInlineCommit,
    handleSheetCommit,
    bulkAssignManager,
  }
}
