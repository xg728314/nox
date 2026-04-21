import type { BLEEvent } from "./events";

const MAX_KEYS = 2000;
/** Bucket size for fallback key (ms). Must match server ingest for idempotency. */
export const TS_BUCKET_MS = 2000;

/** Minimal payload for idempotency key (used by ingest API and client). */
export type EventKeyPayload = {
  event_id?: string | null;
  store_id?: string | number;
  tag_id?: string;
  event_type?: string;
  ts?: number | string;
};

function tsToBucket(ts: number | string | undefined): number {
  if (ts === undefined || ts === null) return 0;
  const ms = typeof ts === "number" ? ts : (typeof ts === "string" ? new Date(ts).getTime() : 0);
  return Number.isFinite(ms) ? Math.floor(ms / TS_BUCKET_MS) : 0;
}

/**
 * Canonical idempotency key: event_id when present, else deterministic fallback.
 * Use this for both API ingest dedupe and client dedupe so behavior is aligned.
 */
export function computeEventKeyFromPayload(ev: EventKeyPayload): string {
  const eventId = typeof ev.event_id === "string" ? ev.event_id.trim() : "";
  if (eventId) return eventId;

  const storeId = String(ev.store_id ?? "").trim();
  const tagId = String(ev.tag_id ?? "").trim();
  const eventType = String(ev.event_type ?? "").trim();
  const tsBucket = tsToBucket(ev.ts);

  return `${storeId}|${tagId}|${eventType}|${tsBucket}`;
}

/**
 * computeEventKey(ev)
 * - Primary: event_id
 * - Fallback: `${store_id}|${tag_id}|${event_type}|${ts_bucket}`
 *   where ts_bucket = floor(ts_ms / TS_BUCKET_MS)
 */
export function computeEventKey(
  ev: Pick<BLEEvent, "store_id" | "tag_id" | "event_type" | "ts"> & { event_id?: string | null | undefined }
): string {
  return computeEventKeyFromPayload({
    event_id: ev.event_id,
    store_id: ev.store_id,
    tag_id: ev.tag_id,
    event_type: ev.event_type,
    ts: (ev as { ts?: number }).ts
  });
}

/**
 * Lightweight LRU-ish recent-event cache (Set insertion order).
 * - If key already exists => duplicate
 * - Keep most recently seen by delete+add on hit
 * - Evict oldest when size exceeds MAX_KEYS
 */
const recentKeys = new Set<string>();

export function isDuplicateBleEvent(
  ev: Pick<BLEEvent, "store_id" | "tag_id" | "event_type" | "ts"> & { event_id?: string | null | undefined }
): boolean {
  const key = computeEventKey(ev);

  if (recentKeys.has(key)) {
    // refresh recency (LRU-ish)
    recentKeys.delete(key);
    recentKeys.add(key);
    return true;
  }

  recentKeys.add(key);

  while (recentKeys.size > MAX_KEYS) {
    const oldest = recentKeys.values().next().value as string | undefined;
    if (!oldest) break;
    recentKeys.delete(oldest);
  }

  return false;
}

// Test/debug helper (not used in prod code paths).
export function __resetBleDedupeForTests(): void {
  recentKeys.clear();
}
