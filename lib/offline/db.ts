/**
 * NOX Offline Storage — IndexedDB 기반
 *
 * 규칙:
 * - final 정산 확정은 오프라인 금지
 * - 충돌 시 서버 우선 + conflict_pending 상태
 * - localStorage 사용 금지 (업무 데이터)
 */

import { isForbiddenOfflineType, ForbiddenOfflineTypeError } from "./forbidden"

const DB_NAME = "nox_offline"
const DB_VERSION = 1

type DraftStatus = "draft" | "syncing" | "synced" | "conflict_pending" | "error"

export type SessionDraft = {
  id: string
  room_uuid: string
  store_uuid: string
  data: Record<string, unknown>
  status: DraftStatus
  created_at: string
}

export type OrderDraft = {
  id: string
  session_id: string
  data: Record<string, unknown>
  status: DraftStatus
  created_at: string
}

export type QueuedEvent = {
  id: string
  type: string
  payload: Record<string, unknown>
  created_at: string
  retry_count: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result

      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" })
        store.createIndex("room_uuid", "room_uuid", { unique: false })
        store.createIndex("status", "status", { unique: false })
      }

      if (!db.objectStoreNames.contains("orders")) {
        const store = db.createObjectStore("orders", { keyPath: "id" })
        store.createIndex("session_id", "session_id", { unique: false })
        store.createIndex("status", "status", { unique: false })
      }

      if (!db.objectStoreNames.contains("event_queue")) {
        const store = db.createObjectStore("event_queue", { keyPath: "id" })
        store.createIndex("type", "type", { unique: false })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Generic helpers ────────────────────────────────────────

function tx(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(storeName, mode).objectStore(storeName)
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function generateId(): string {
  return crypto.randomUUID()
}

// ─── Sessions ───────────────────────────────────────────────

export async function saveSessionDraft(
  draft: Omit<SessionDraft, "id" | "created_at" | "status">
): Promise<SessionDraft> {
  const db = await open()
  const record: SessionDraft = {
    ...draft,
    id: generateId(),
    status: "draft",
    created_at: new Date().toISOString(),
  }
  await reqToPromise(tx(db, "sessions", "readwrite").put(record))
  db.close()
  return record
}

export async function getSessionDraft(id: string): Promise<SessionDraft | undefined> {
  const db = await open()
  const result = await reqToPromise<SessionDraft | undefined>(
    tx(db, "sessions", "readonly").get(id)
  )
  db.close()
  return result
}

export async function getSessionDraftsByRoom(roomUuid: string): Promise<SessionDraft[]> {
  const db = await open()
  const result = await reqToPromise<SessionDraft[]>(
    tx(db, "sessions", "readonly").index("room_uuid").getAll(roomUuid)
  )
  db.close()
  return result
}

export async function getAllSessionDrafts(): Promise<SessionDraft[]> {
  const db = await open()
  const result = await reqToPromise<SessionDraft[]>(
    tx(db, "sessions", "readonly").getAll()
  )
  db.close()
  return result
}

export async function updateSessionDraftStatus(
  id: string,
  status: DraftStatus
): Promise<void> {
  const db = await open()
  const store = tx(db, "sessions", "readwrite")
  const existing = await reqToPromise<SessionDraft | undefined>(store.get(id))
  if (existing) {
    existing.status = status
    await reqToPromise(store.put(existing))
  }
  db.close()
}

export async function deleteSessionDraft(id: string): Promise<void> {
  const db = await open()
  await reqToPromise(tx(db, "sessions", "readwrite").delete(id))
  db.close()
}

// ─── Orders ─────────────────────────────────────────────────

export async function saveOrderDraft(
  draft: Omit<OrderDraft, "id" | "created_at" | "status">
): Promise<OrderDraft> {
  const db = await open()
  const record: OrderDraft = {
    ...draft,
    id: generateId(),
    status: "draft",
    created_at: new Date().toISOString(),
  }
  await reqToPromise(tx(db, "orders", "readwrite").put(record))
  db.close()
  return record
}

export async function getOrderDraft(id: string): Promise<OrderDraft | undefined> {
  const db = await open()
  const result = await reqToPromise<OrderDraft | undefined>(
    tx(db, "orders", "readonly").get(id)
  )
  db.close()
  return result
}

export async function getOrderDraftsBySession(sessionId: string): Promise<OrderDraft[]> {
  const db = await open()
  const result = await reqToPromise<OrderDraft[]>(
    tx(db, "orders", "readonly").index("session_id").getAll(sessionId)
  )
  db.close()
  return result
}

export async function getAllOrderDrafts(): Promise<OrderDraft[]> {
  const db = await open()
  const result = await reqToPromise<OrderDraft[]>(
    tx(db, "orders", "readonly").getAll()
  )
  db.close()
  return result
}

export async function updateOrderDraftStatus(
  id: string,
  status: DraftStatus
): Promise<void> {
  const db = await open()
  const store = tx(db, "orders", "readwrite")
  const existing = await reqToPromise<OrderDraft | undefined>(store.get(id))
  if (existing) {
    existing.status = status
    await reqToPromise(store.put(existing))
  }
  db.close()
}

export async function deleteOrderDraft(id: string): Promise<void> {
  const db = await open()
  await reqToPromise(tx(db, "orders", "readwrite").delete(id))
  db.close()
}

// ─── Event Queue ────────────────────────────────────────────

export async function enqueueEvent(
  type: string,
  payload: Record<string, unknown>
): Promise<QueuedEvent> {
  // 클라이언트 enqueue 시점 방어. 서버 sync skip 과 별개로 UI 가 "저장됨"
  // 으로 오인하지 않도록 즉시 throw. lib/offline/forbidden.ts 단일 출처.
  if (isForbiddenOfflineType(type)) {
    throw new ForbiddenOfflineTypeError(type)
  }
  const db = await open()
  const record: QueuedEvent = {
    id: generateId(),
    type,
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
  }
  await reqToPromise(tx(db, "event_queue", "readwrite").put(record))
  db.close()
  return record
}

export async function getAllQueuedEvents(): Promise<QueuedEvent[]> {
  const db = await open()
  const result = await reqToPromise<QueuedEvent[]>(
    tx(db, "event_queue", "readonly").getAll()
  )
  db.close()
  return result
}

export async function incrementRetry(id: string): Promise<void> {
  const db = await open()
  const store = tx(db, "event_queue", "readwrite")
  const existing = await reqToPromise<QueuedEvent | undefined>(store.get(id))
  if (existing) {
    existing.retry_count += 1
    await reqToPromise(store.put(existing))
  }
  db.close()
}

export async function deleteQueuedEvent(id: string): Promise<void> {
  const db = await open()
  await reqToPromise(tx(db, "event_queue", "readwrite").delete(id))
  db.close()
}

export async function clearEventQueue(): Promise<void> {
  const db = await open()
  await reqToPromise(tx(db, "event_queue", "readwrite").clear())
  db.close()
}

// ─── Utilities ──────────────────────────────────────────────

export async function getConflictPendingItems(): Promise<{
  sessions: SessionDraft[]
  orders: OrderDraft[]
}> {
  const db = await open()

  const sessions = await reqToPromise<SessionDraft[]>(
    tx(db, "sessions", "readonly").index("status").getAll("conflict_pending")
  )
  const orders = await reqToPromise<OrderDraft[]>(
    tx(db, "orders", "readonly").index("status").getAll("conflict_pending")
  )

  db.close()
  return { sessions, orders }
}

export async function destroyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
