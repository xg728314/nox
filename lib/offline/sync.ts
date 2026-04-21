/**
 * NOX Offline Sync — 온라인 복구 시 event_queue → 서버 전송 + conflict 처리
 *
 * 규칙:
 * - final 정산 확정은 오프라인 전송 불가 (settlement, receipt 타입 거부)
 * - 충돌(409) → conflict_pending 상태로 마킹, 서버 우선
 * - 최대 3회 재시도, 초과 시 error 상태
 */

import {
  getAllQueuedEvents,
  deleteQueuedEvent,
  incrementRetry,
  updateSessionDraftStatus,
  updateOrderDraftStatus,
  type QueuedEvent,
} from "./db"

const MAX_RETRIES = 3

// 오프라인 전송 금지 타입 — 서버 전용 처리 필수
const FORBIDDEN_OFFLINE_TYPES = [
  "settlement",       // 정산 생성
  "receipt",           // 영수증 스냅샷
  "finalize",          // 정산 확정
  "payment",           // 결제 방식 확정
  "finalize-settlement", // 정산 확정 (별칭)
  "close-day",         // 영업일 마감
]

type SyncResult = {
  total: number
  synced: number
  failed: number
  conflict: number
  skipped: number
  details: {
    id: string
    type: string
    status: "synced" | "failed" | "conflict" | "skipped" | "max_retries"
    error?: string
  }[]
}

// SECURITY (R-1): no more manual token reads — the HttpOnly cookie
// travels with every request via `credentials: "include"`.
async function sendToServer(
  event: QueuedEvent,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const endpointMap: Record<string, { url: string; method: string }> = {
    // 세션 기본
    checkin: { url: "/api/sessions/checkin", method: "POST" },
    participant: { url: "/api/sessions/participants", method: "POST" },
    order: { url: "/api/sessions/orders", method: "POST" },
    extend: { url: "/api/sessions/extend", method: "POST" },
    "mid-out": { url: "/api/sessions/mid-out", method: "POST" },
    checkout: { url: "/api/sessions/checkout", method: "POST" },
    // 선정산 — 세션 진행 중 등록 가능
    "pre-settlement": { url: "/api/sessions/pre-settlement", method: "POST" },
    // 외상 — 등록만 (회수/취소는 온라인 필수)
    credit: { url: "/api/credits", method: "POST" },
    // 재고 — 출고만 (입고/조정은 관리자 온라인 권장)
    "inventory-out": { url: "/api/inventory/transactions", method: "POST" },
    // 채팅 — 메시지 전송
    "chat-message": { url: "/api/chat/messages", method: "POST" },
  }

  const endpoint = endpointMap[event.type]
  if (!endpoint) {
    throw new Error(`Unknown event type: ${event.type}`)
  }

  const res = await fetch(endpoint.url, {
    method: endpoint.method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event.payload),
  })

  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

export async function syncEventQueue(): Promise<SyncResult> {
  const events = await getAllQueuedEvents()
  const result: SyncResult = {
    total: events.length,
    synced: 0,
    failed: 0,
    conflict: 0,
    skipped: 0,
    details: [],
  }

  for (const event of events) {
    // 1. 금지 타입 체크
    if (FORBIDDEN_OFFLINE_TYPES.includes(event.type)) {
      result.skipped += 1
      result.details.push({
        id: event.id,
        type: event.type,
        status: "skipped",
        error: "Settlement/receipt operations are forbidden offline.",
      })
      continue
    }

    // 2. 최대 재시도 초과
    if (event.retry_count >= MAX_RETRIES) {
      result.failed += 1
      result.details.push({
        id: event.id,
        type: event.type,
        status: "max_retries",
        error: `Exceeded ${MAX_RETRIES} retries.`,
      })
      // draft를 error 상태로 변경
      await markDraftError(event)
      continue
    }

    try {
      const response = await sendToServer(event)

      if (response.ok) {
        // 성공 → 큐에서 제거, draft synced
        await deleteQueuedEvent(event.id)
        await markDraftSynced(event)
        result.synced += 1
        result.details.push({
          id: event.id,
          type: event.type,
          status: "synced",
        })
      } else if (response.status === 409) {
        // 충돌 → 서버 우선, conflict_pending 마킹
        await deleteQueuedEvent(event.id)
        await markDraftConflict(event)
        result.conflict += 1
        result.details.push({
          id: event.id,
          type: event.type,
          status: "conflict",
          error: response.data?.message as string ?? "Server conflict (409)",
        })
      } else {
        // 다른 에러 → 재시도 카운트 증가
        await incrementRetry(event.id)
        result.failed += 1
        result.details.push({
          id: event.id,
          type: event.type,
          status: "failed",
          error: response.data?.message as string ?? `HTTP ${response.status}`,
        })
      }
    } catch (err) {
      // 네트워크 에러 → 아직 오프라인, 중단
      await incrementRetry(event.id)
      result.failed += 1
      result.details.push({
        id: event.id,
        type: event.type,
        status: "failed",
        error: err instanceof Error ? err.message : "Network error",
      })
      // 네트워크 문제면 나머지도 실패할 가능성 높음 → 중단
      break
    }
  }

  return result
}

// ─── Draft status helpers ───────────────────────────────────

async function markDraftSynced(event: QueuedEvent): Promise<void> {
  const draftId = event.payload.offline_draft_id as string | undefined
  if (!draftId) return

  if (event.type === "checkin") {
    await updateSessionDraftStatus(draftId, "synced")
  } else if (event.type === "order") {
    await updateOrderDraftStatus(draftId, "synced")
  }
}

async function markDraftConflict(event: QueuedEvent): Promise<void> {
  const draftId = event.payload.offline_draft_id as string | undefined
  if (!draftId) return

  if (event.type === "checkin") {
    await updateSessionDraftStatus(draftId, "conflict_pending")
  } else if (event.type === "order") {
    await updateOrderDraftStatus(draftId, "conflict_pending")
  }
}

async function markDraftError(event: QueuedEvent): Promise<void> {
  const draftId = event.payload.offline_draft_id as string | undefined
  if (!draftId) return

  if (event.type === "checkin") {
    await updateSessionDraftStatus(draftId, "error")
  } else if (event.type === "order") {
    await updateOrderDraftStatus(draftId, "error")
  }
}

// ─── Online listener ────────────────────────────────────────

let listenerRegistered = false

export function registerOnlineListener(): void {
  if (typeof window === "undefined" || listenerRegistered) return

  window.addEventListener("online", async () => {
    console.log("[NOX Sync] Online detected — starting queue sync...")
    const result = await syncEventQueue()
    console.log("[NOX Sync] Sync complete:", {
      synced: result.synced,
      failed: result.failed,
      conflict: result.conflict,
      skipped: result.skipped,
    })
  })

  listenerRegistered = true
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true
  return navigator.onLine
}
