/**
 * counterApi — CounterPageV2 계층의 API 호출을 한 곳에 모은 service layer.
 *
 * P0 구조 분해 (2026-04-18):
 *   - 기존: CounterPageV2.tsx 안에서 apiFetch("/api/...") 20여 회가 직접 호출.
 *   - 현재: 페이지 / 훅은 이 파일의 함수만 호출한다.
 *
 * 절대 규칙
 *   - 동작 변경 금지. HTTP method / 경로 / body / 반환 shape 모두 기존과
 *     byte-identical.
 *   - 에러 처리 정책은 호출자가 결정 (여기서는 Response/파싱된 JSON 또는 null
 *     반환). 메시지 문구는 호출자 쪽에 남아있는 기존 문자열 그대로.
 *   - lib/apiFetch.ts 의 Bearer 토큰 주입 / Content-Type 기본값은 그대로
 *     재사용.
 *
 * 이 파일은 business logic 이 아니다 — 서버 호출의 단일 진입점.
 */

import { apiFetch } from "@/lib/apiFetch"
import type { StaffItem, Room } from "../types"

// ── 공통 helper ───────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T
  return data
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: unknown }

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await apiFetch(url, init)
  const data = await res.json().catch(() => ({}))
  return res.ok
    ? { ok: true, status: res.status, data: data as T }
    : { ok: false, status: res.status, data }
}

// ── chat / inventory / stats / staff pool ─────────────────────────

export async function fetchChatUnreadTotal(): Promise<number> {
  const res = await apiFetch("/api/chat/unread")
  if (!res.ok) return 0
  const d = await res.json().catch(() => ({}))
  return typeof d?.total === "number" ? d.total : 0
}

export async function fetchInventoryItems<T = unknown>(): Promise<T[]> {
  const res = await apiFetch("/api/inventory/items")
  if (!res.ok) return []
  const d = await res.json().catch(() => ({}))
  return (d?.items ?? []) as T[]
}

export async function fetchHostessStats<T = unknown>(): Promise<T | null> {
  const res = await apiFetch("/api/manager/hostess-stats")
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as T | null
}

export async function fetchHostessPool(): Promise<Array<Record<string, unknown>>> {
  const res = await apiFetch("/api/store/staff?role=hostess")
  if (!res.ok) return []
  const d = await res.json().catch(() => ({}))
  return (d?.staff ?? []) as Array<Record<string, unknown>>
}

// ── rooms ─────────────────────────────────────────────────────────

export async function fetchRoomsSnapshot(): Promise<Room[] | null> {
  const res = await apiFetch("/api/rooms")
  if (!res.ok) return null
  const d = await res.json().catch(() => ({}))
  return (d?.rooms ?? null) as Room[] | null
}

export async function createRoom(): Promise<ApiResult<{ room?: Room; message?: string }>> {
  return request("/api/rooms", { method: "POST" })
}

// ── sessions ──────────────────────────────────────────────────────

export async function checkinSession(roomUuid: string): Promise<ApiResult<{
  session_id?: string
  started_at?: string
  message?: string
}>> {
  return request("/api/sessions/checkin", {
    method: "POST",
    body: JSON.stringify({ room_uuid: roomUuid }),
  })
}

export async function midOutParticipant(
  sessionId: string,
  participantId: string,
): Promise<ApiResult<{ message?: string }>> {
  return request("/api/sessions/mid-out", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, participant_id: participantId }),
  })
}

export async function patchSession(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<ApiResult<{ message?: string }>> {
  return request(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

// ── participants ──────────────────────────────────────────────────

export async function patchParticipant(
  participantId: string,
  body: Record<string, unknown>,
): Promise<ApiResult<{ message?: string }>> {
  return request(`/api/sessions/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

/**
 * update_external_name 편의 래퍼 — 기존 handleNameBlur 가 보내던 body 그대로.
 */
export async function updateParticipantExternalName(
  participantId: string,
  externalName: string,
): Promise<ApiResult<{ message?: string }>> {
  return patchParticipant(participantId, {
    action: "update_external_name",
    external_name: externalName,
  })
}

// ── managers / staff directory ────────────────────────────────────

/**
 * 2026-05-03 R-Privacy: store_name → store_uuid.
 *   기존 fetchManagersForStore(storeName) 은 매장 한글명을 URL 에 노출 →
 *   access log / Sentry / 브라우저 히스토리 누출. UUID 만 사용.
 *
 *   storeName 호환 wrapper 는 useBulkManagerPicker 등 마이그 안 끝난
 *   호출자용. 신규 코드는 fetchManagersForStoreUuid 직접 사용.
 */
export async function fetchManagersForStoreUuid(storeUuid: string | null | undefined): Promise<{
  staff: StaffItem[]
  store_uuid: string | null
}> {
  const url = storeUuid && storeUuid.length > 0
    ? `/api/store/staff?role=manager&store_uuid=${encodeURIComponent(storeUuid)}`
    : "/api/store/staff?role=manager"
  const res = await apiFetch(url)
  if (!res.ok) return { staff: [], store_uuid: null }
  const d = await res.json().catch(() => ({}))
  return {
    staff: (d?.staff ?? []) as StaffItem[],
    store_uuid: (d?.store_uuid ?? null) as string | null,
  }
}

/**
 * 매장 한글명만 알고 uuid 모를 때 manager 목록 fetch.
 *
 * 2026-05-03 R-Privacy: 기존 GET 경로는 매장명을 URL query 에 노출 →
 *   브라우저 history / access log / Sentry 에 평문 누설. POST body 로 전송하면
 *   URL 에는 path 만 남고 매장명은 안 남는다.
 *
 *   가능하면 fetchManagersForStoreUuid (uuid 사용) 가 우선. 이 함수는 staff
 *   chat 파서처럼 사용자 입력에서 매장명만 알고 uuid 매핑이 없는 경로 전용.
 */
export async function fetchManagersForStore(storeName: string | null | undefined): Promise<{
  staff: StaffItem[]
  store_uuid: string | null
}> {
  const res = await apiFetch("/api/store/staff", {
    method: "POST",
    body: JSON.stringify({
      role: "manager",
      store_name: storeName ?? null,
    }),
  })
  if (!res.ok) return { staff: [], store_uuid: null }
  const d = await res.json().catch(() => ({}))
  return {
    staff: (d?.staff ?? []) as StaffItem[],
    store_uuid: (d?.store_uuid ?? null) as string | null,
  }
}

// ── customers ─────────────────────────────────────────────────────

export async function searchCustomers<T = unknown>(q: string): Promise<T[]> {
  const res = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  const d = await res.json().catch(() => ({}))
  return (d?.customers ?? []) as T[]
}

export async function createCustomer(body: {
  name: string
  phone?: string
}): Promise<ApiResult<{ customer?: unknown; message?: string }>> {
  return request("/api/customers", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// ── re-export shared shape so callers don't re-import Response typing ──

export { jsonOrThrow }
