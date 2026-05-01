"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { getExtendMinutes, type ExtendType } from "../helpers"
import type { FocusData } from "../types"

/**
 * useParticipantMutations — owns selectedIds (participant selection state) and
 * the three participant-flow handlers: handleAddHostess / handleMidOut /
 * handleExtendRoom. Extracted verbatim from CounterPageV2.
 */

type Deps = {
  focusRoomId: string | null
  focusData: FocusData | null
  fetchRooms: () => Promise<void>
  fetchFocusData: (roomId: string, sessionId: string, startedAt: string) => Promise<void>
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
}

type AddHostessWithNameArgs = {
  external_name: string
  /**
   * Known active session id. When provided, the handler SKIPS the
   * session-checkin path entirely — avoiding the 409 "세션 생성 실패"
   * surface that otherwise fires on active rooms if the checkin route
   * returns 409 without a session_id in the body. Callers that already
   * hold a session id (active-room submit from RoomCardV2, or the
   * empty-room flow after `onEnsureSession` resolves) MUST pass it.
   */
  session_id?: string | null
  /**
   * Parser-extracted home store label (e.g. "라이브"). Informational only
   * for now — persisting to `origin_store_uuid` requires a store_name →
   * uuid resolver that isn't wired yet. Forwarded through the handler
   * signature so the UI layer can start passing it, and a future patch
   * can pick it up without changing callers.
   */
  origin_store_name?: string | null
  /**
   * Parser-extracted category label ("퍼블릭" | "셔츠" | "하퍼"). When
   * present AND valid, written to the created participant's `category`
   * on POST so the placeholder is no longer "unresolved" on that axis.
   */
  category?: string | null
  /**
   * Parser-extracted ticket label ("완티" | "반티" | "차3" | "반차3").
   * When paired with a valid category, mapped to POST body
   * { time_type, time_minutes } so the server runs its authoritative DB
   * pricing lookup. Nominal minutes match the standard durations locked
   * in CLAUDE.md — never used for client-side money math.
   */
  ticket_type?: string | null
}

export type AddHostessWithNameResult = {
  ok: boolean
  participant_id?: string
  error?: string
  /**
   * Non-fatal diagnostic surfaced to the UI when a step after the core
   * POST+PATCH(external_name) chain had an issue (currently: store
   * affiliation resolver failure). The participant row is still created;
   * `ok` stays true. Callers may aggregate warnings separately from
   * hard failures.
   */
  warning?: string
}

type UseParticipantMutationsReturn = {
  selectedIds: Set<string>
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  handleAddHostess: () => Promise<void>
  handleMidOut: (participantId: string) => Promise<void>
  handleExtendRoom: (type: ExtendType, participantIds?: string[]) => Promise<void>
  /**
   * P0 구조 분해: 이전 CounterPageV2 안에 있던 두 handler를 여기로 옮김.
   * 동작 변경 없음 — 기존 문자열/흐름 그대로.
   */
  handleNameBlur: (
    participantId: string,
    currentName: string | null | undefined,
    nextName: string,
  ) => Promise<void>
  handleDeleteUnsetParticipant: (participantId: string) => Promise<void>
  /**
   * Phase 4: additive handler. DOES NOT modify or replace handleAddHostess.
   * Two-step create flow required because POST /api/sessions/participants
   * does NOT accept external_name in its JSON body (verified against
   * app/api/sessions/participants/route.ts — see Phase 4 API CREATE FLOW
   * FINDING):
   *   1) POST placeholder participant (same payload shape as handleAddHostess)
   *   2) PATCH update_external_name on the created row
   * Returns a structured result so the caller can surface per-name errors
   * without silently swallowing partial failures.
   */
  handleAddHostessWithName: (args: AddHostessWithNameArgs) => Promise<AddHostessWithNameResult>
}

// Allowed category labels per server route (placeholder path accepts any,
// but we guard client-side to avoid storing garbage). Mirrors the list in
// app/api/sessions/participants/route.ts VALID_CATEGORIES minus "차3"
// (which is a ticket artifact, not a real category label from the parser).
const VALID_CATS = ["퍼블릭", "셔츠", "하퍼"] as const

// ── Store-name → store_uuid resolver cache ─────────────────────────
//
// Memoizes /api/store/staff?store_name=<name> lookups so a multi-name
// submit against the same origin store only hits the network once.
// Cache lives for the hook's module lifetime; operator rarely edits
// store names mid-session, and a stale hit would only mis-label one
// cross-store badge which is display-only (no settlement impact).
const storeUuidCache: Map<string, string | null> = new Map()

async function resolveStoreUuidByName(name: string): Promise<string | null> {
  const key = name.trim()
  if (!key) return null
  if (storeUuidCache.has(key)) return storeUuidCache.get(key) ?? null
  try {
    const res = await apiFetch(
      `/api/store/staff?role=hostess&store_name=${encodeURIComponent(key)}`
    )
    if (!res.ok) { storeUuidCache.set(key, null); return null }
    const data = await res.json()
    const uuid = typeof data?.store_uuid === "string" ? data.store_uuid : null
    storeUuidCache.set(key, uuid)
    return uuid
  } catch {
    return null
  }
}

// ticketToPreset 은 helpers/categoryRegistry.ts 의 단일 원본에서 파생.
// 기존 import 경로 (`import { ticketToPreset } from "../hooks/useParticipantMutations"`)
// 유지하기 위해 여기서 re-export 한다. 새 위치에서 직접 import 해도 동일.
import { ticketToPreset } from "../helpers/categoryRegistry"
export { ticketToPreset }
export type { TicketPreset } from "../helpers/categoryRegistry"

export function useParticipantMutations(deps: Deps): UseParticipantMutationsReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  async function handleAddHostess() {
    const { focusRoomId, focusData, fetchRooms, fetchFocusData, setBusy, setError } = deps
    if (!focusRoomId) { setError("방이 선택되지 않았습니다"); return }
    setBusy(true); setError("")
    try {
      let sessionId = focusData?.sessionId
      if (!sessionId) {
        const res = await apiFetch("/api/sessions/checkin", {
          method: "POST", body: JSON.stringify({ room_uuid: focusRoomId }),
        })
        const data = await res.json()
        if (!res.ok && res.status !== 409) { setError(data.message || "세션 생성 실패"); return }
        sessionId = data.session_id
        if (!sessionId) { setError("세션 생성 실패"); return }
      }
      const res = await apiFetch("/api/sessions/participants", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: "00000000-0000-0000-0000-000000000000",
          role: "hostess", time_minutes: 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "참여자 추가 실패"); return }
      // 2026-05-01 R-Counter-Speed: await 제거 → busy 즉시 false.
      //   refetch 는 background. realtime patch 가 실시간 sync (useRealtimePatchWiring).
      //   사용자 체감 1-2초 → 0.3초 (POST 응답만 기다림).
      void fetchRooms()
      if (focusRoomId && sessionId) void fetchFocusData(focusRoomId, sessionId, "")
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  async function handleMidOut(participantId: string) {
    const { focusData, fetchFocusData, setBusy, setError } = deps
    if (!focusData) return
    // 이미 처리된 participant는 건너뛰기
    const p = focusData.participants.find(x => x.id === participantId)
    if (!p || p.status !== "active") return
    const elapsedMin = p.entered_at
      ? Math.floor((Date.now() - new Date(p.entered_at).getTime()) / 60000)
      : 0
    const isKick = elapsedMin < 12
    const msg = isKick
      ? `${elapsedMin}분 경과 — 팅김 처리합니다. (정산 미반영)\n계속하시겠습니까?`
      : `${elapsedMin}분 경과 — 퇴실 처리합니다. (정산 반영)\n계속하시겠습니까?`
    if (!confirm(msg)) return
    setBusy(true); setError("")
    try {
      const res = await apiFetch("/api/sessions/mid-out", {
        method: "POST",
        body: JSON.stringify({ session_id: focusData.sessionId, participant_id: participantId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "제거 실패"); return }
      // 즉시 선택 상태에서 제거 + 데이터 갱신
      setSelectedIds(prev => { const next = new Set(prev); next.delete(participantId); return next })
      // 2026-05-01 R-Counter-Speed: await 제거. realtime + background sync.
      void fetchFocusData(focusData.roomId, focusData.sessionId, focusData.started_at)
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  async function handleExtendRoom(type: ExtendType, participantIds?: string[]) {
    const { focusData, fetchFocusData, setBusy, setError } = deps
    if (!focusData) return
    const activeHostesses = focusData.participants.filter(
      p => p.role === "hostess" && p.status === "active" && p.category && p.time_minutes > 0
    )
    // 대상: participantIds 지정 시 해당 개별만, 아니면 방 전체
    const targets = participantIds
      ? activeHostesses.filter(p => participantIds.includes(p.id))
      : activeHostesses
    if (targets.length === 0) { setError("연장 대상이 없습니다. 종목이 확정된 스태프만 연장 가능합니다."); return }
    setBusy(true); setError("")
    try {
      await Promise.all(targets.map(p =>
        apiFetch("/api/sessions/extend", {
          method: "POST",
          body: JSON.stringify({
            session_id: focusData.sessionId,
            participant_id: p.id,
            extend_minutes: getExtendMinutes(p.category, type),
          }),
        })
      ))
      setSelectedIds(new Set())
      void fetchFocusData(focusData.roomId, focusData.sessionId, focusData.started_at)
    } catch { setError("연장 실패") }
    finally { setBusy(false) }
  }

  /**
   * Phase 4: additive handler. Creates an unresolved placeholder participant
   * (same call shape as handleAddHostess) then PATCHes external_name. Does
   * NOT call handleAddHostess directly — keeps that handler's behavior
   * byte-identical for any existing callsite.
   *
   * Caller batches refresh of rooms / focus data after all names succeed to
   * avoid N sequential refetches.
   */
  async function handleAddHostessWithName(
    args: AddHostessWithNameArgs
  ): Promise<AddHostessWithNameResult> {
    const { focusRoomId, focusData, setError } = deps
    const trimmed = (args.external_name ?? "").trim()
    if (!trimmed) {
      return { ok: false, error: "이름이 비어 있습니다." }
    }
    if (!focusRoomId) {
      const msg = "방이 선택되지 않았습니다"
      setError(msg)
      return { ok: false, error: msg }
    }
    try {
      // Step 0: resolve session id.
      //
      // Order of preference (critical for BUG 1 — active-room 409 fix):
      //   1. Explicit `args.session_id` from the caller — trusted as-is,
      //      NO checkin call. This is the active-room path: RoomCardV2
      //      passes `room.session.id` when the room is already active,
      //      so we never re-enter the checkin flow (which can return 409
      //      without `session_id` and produce a spurious "세션 생성 실패").
      //   2. `focusData.sessionId` from the hook's dependency snapshot.
      //   3. Fall back to checkin — only when we truly have no session.
      let sessionId: string | null | undefined = args.session_id ?? focusData?.sessionId
      if (!sessionId) {
        const res = await apiFetch("/api/sessions/checkin", {
          method: "POST",
          body: JSON.stringify({ room_uuid: focusRoomId }),
        })
        const data = await res.json()
        if (!res.ok && res.status !== 409) {
          return { ok: false, error: data?.message || "세션 생성 실패" }
        }
        sessionId = data.session_id
        if (!sessionId) {
          return { ok: false, error: "세션 생성 실패" }
        }
      }

      // Step 1: POST placeholder participant.
      //
      // Parser-extracted category / ticket are folded into the POST body
      // when valid so the server writes them on creation — authoritative
      // pricing flows from store_service_types via resolvedTimeType. If
      // the parser didn't supply them, we POST a bare placeholder exactly
      // as the legacy flow did (time_minutes=0, no category → route
      // treats as "무료" and skips pricing lookup).
      //
      // Manager is INTENTIONALLY left unset: we don't send
      // manager_membership_id in the POST body, and no follow-up PATCH
      // sets it. The operator wires the manager later via the existing
      // manager-change modal.
      //
      // INVARIANT (LOCKED — Priority 2 fix):
      //   The preset time (time_minutes) MUST be derived from the
      //   per-entry PARTICIPANT category (`args.category`) + ticket
      //   (`args.ticket_type`) ONLY. Never from the room's
      //   dominantCategory, never from any room-level default. This
      //   guarantees "퍼블릭 + 완티 → 90분" even inside a 셔츠 room, and
      //   "셔츠 + 완티 → 60분" even inside a 퍼블릭 room. The room
      //   dominantCategory is a parser-input default (used by
      //   parseStaffChat when no category token is found in the line);
      //   once the parser emits entry.category, the handler treats it as
      //   authoritative and does not re-consult room context here.
      const cat = (args.category && (VALID_CATS as readonly string[]).includes(args.category))
        ? args.category : null
      const preset = cat ? ticketToPreset(args.ticket_type, cat) : null
      const postBody: Record<string, unknown> = {
        session_id: sessionId,
        membership_id: "00000000-0000-0000-0000-000000000000",
        role: "hostess",
        time_minutes: preset?.time_minutes ?? 0,
        // Chat-based bulk input auto-confirms greeting so category/ticket
        // combinations that require 인사확인 (e.g. 셔츠 + 완티/반티)
        // don't 400 with "인사확인이 필요합니다 (greeting_confirmed=true)".
        // Scope is limited to this handler — manual UI flows
        // (handleAddHostess, ParticipantSetupSheetV2 edits) are unchanged.
        greeting_confirmed: true,
      }
      if (cat) postBody.category = cat
      if (preset) postBody.time_type = preset.time_type
      const createRes = await apiFetch("/api/sessions/participants", {
        method: "POST",
        body: JSON.stringify(postBody),
      })
      const createData = await createRes.json()
      if (!createRes.ok) {
        return { ok: false, error: createData?.message || "참여자 추가 실패" }
      }
      const participantId: string | undefined = createData.participant_id
      if (!participantId) {
        return { ok: false, error: "참여자 ID를 받지 못했습니다." }
      }

      // Step 2: PATCH external_name using the existing supported action.
      // Route path: app/api/sessions/participants/[participant_id]/route.ts
      // verified to accept { action: "update_external_name", external_name }.
      const patchRes = await apiFetch(`/api/sessions/participants/${participantId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "update_external_name", external_name: trimmed }),
      })
      if (!patchRes.ok) {
        const patchData = await patchRes.json().catch(() => ({}))
        // Placeholder participant was still created successfully — surface
        // the failure but don't attempt to roll it back. Operator can set
        // the name via the existing inline edit on the unresolved card.
        return {
          ok: false,
          participant_id: participantId,
          error: patchData?.message || "이름 설정 실패 (참여자는 생성됨)",
        }
      }

      // Step 2b: store affiliation — resolve parser's origin_store_name
      // to a real store_uuid and PATCH it onto the participant row so the
      // participant is a first-class citizen of that store (not just
      // an "informational hint"). The PATCH goes through the
      // fillUnspecified dispatch branch (triggered by membership_id in
      // the body) which accepts origin_store_uuid; we pass membership_id
      // as null so the server keeps the placeholder membership. Category
      // and time_minutes are omitted so fillUnspecified re-uses the
      // values already on the row (set in step 1 POST) — no client-side
      // re-derivation. This block NEVER fails participant creation; if
      // the resolver returns no match or the PATCH errors, we keep the
      // row and surface a warning.
      let affiliationWarning: string | null = null
      const originName = args.origin_store_name?.trim() ?? ""
      if (originName) {
        const resolvedUuid = await resolveStoreUuidByName(originName)
        if (!resolvedUuid) {
          affiliationWarning = `소속 매장 "${originName}" 를 찾지 못했습니다.`
        } else {
          const affRes = await apiFetch(
            `/api/sessions/participants/${participantId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                membership_id: null,
                origin_store_uuid: resolvedUuid,
              }),
            }
          )
          if (!affRes.ok) {
            const d = await affRes.json().catch(() => ({}))
            affiliationWarning =
              `소속 매장 설정 실패 (${originName}): ${d?.message ?? ""}`.trim()
          }
        }
      }

      // Step 3 (optional): "반차3" boundary — apply a cha3 add-on on top
      // of the 반티 base that was already written in the POST. Uses the
      // existing server action; pricing comes from DB (cha3_amount on
      // the participant row, itself derived from store_service_types).
      if (preset?.follow_up === "cha3") {
        const cha3Res = await apiFetch(
          `/api/sessions/participants/${participantId}`,
          { method: "PATCH", body: JSON.stringify({ action: "cha3" }) }
        )
        if (!cha3Res.ok) {
          const d = await cha3Res.json().catch(() => ({}))
          return {
            ok: false,
            participant_id: participantId,
            error: d?.message || "반차3 처리 실패 (반티까지 적용됨)",
          }
        }
      }

      return {
        ok: true,
        participant_id: participantId,
        ...(affiliationWarning ? { warning: affiliationWarning } : {}),
      }
    } catch {
      return { ok: false, error: "요청 오류" }
    }
  }

  // ─── P0 분해: CounterPageV2에서 이관된 2 handler ─────────────────
  //
  // 동작 변경 없음. 기존 body/라벨/refetch 순서 모두 그대로.

  async function handleNameBlur(
    participantId: string,
    currentName: string | null | undefined,
    nextName: string,
  ) {
    const val = nextName.trim()
    if (val === (currentName ?? "").trim()) return
    const res = await apiFetch(`/api/sessions/participants/${participantId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "update_external_name", external_name: val }),
    })
    if (res.ok && deps.focusData?.roomId && deps.focusData?.sessionId) {
      void deps.fetchFocusData(deps.focusData.roomId, deps.focusData.sessionId, deps.focusData.started_at)
    }
  }

  async function handleDeleteUnsetParticipant(participantId: string) {
    const { focusData, fetchFocusData, setBusy, setError } = deps
    if (!focusData) return
    if (!confirm("스태프를 삭제하시겠습니까?")) return
    setBusy(true); setError("")
    try {
      const res = await apiFetch("/api/sessions/mid-out", {
        method: "POST",
        body: JSON.stringify({ session_id: focusData.sessionId, participant_id: participantId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "삭제 실패"); return }
      setSelectedIds(prev => { const next = new Set(prev); next.delete(participantId); return next })
      void fetchFocusData(focusData.roomId, focusData.sessionId, focusData.started_at)
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  return {
    selectedIds, setSelectedIds,
    handleAddHostess, handleMidOut, handleExtendRoom,
    handleAddHostessWithName,
    handleNameBlur, handleDeleteUnsetParticipant,
  }
}
