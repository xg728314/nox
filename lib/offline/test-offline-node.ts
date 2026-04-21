/**
 * Offline DB 모듈 구조 검증 (import/export 무결성 테스트)
 * IndexedDB는 브라우저 전용이므로 여기서는 타입/export 확인만 수행
 */

import type { SessionDraft, OrderDraft, QueuedEvent } from "./db"

// Type-level tests: 타입이 올바르게 정의되어 있는지 확인
function typeTests() {
  // SessionDraft
  const s: SessionDraft = {
    id: "test",
    room_uuid: "room-1",
    store_uuid: "store-1",
    data: { category: "퍼블릭" },
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
  }

  // OrderDraft
  const o: OrderDraft = {
    id: "test",
    session_id: "sess-1",
    data: { item_name: "양주", qty: 1 },
    status: "conflict_pending",
    created_at: "2026-01-01T00:00:00Z",
  }

  // QueuedEvent
  const e: QueuedEvent = {
    id: "test",
    type: "checkin",
    payload: { room_uuid: "room-1" },
    created_at: "2026-01-01T00:00:00Z",
    retry_count: 0,
  }

  // Status types
  const validStatuses: SessionDraft["status"][] = [
    "draft", "syncing", "synced", "conflict_pending", "error"
  ]

  console.log("Type checks passed:", { s: s.id, o: o.id, e: e.id, statuses: validStatuses.length })
}

typeTests()
