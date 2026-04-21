import type { SupabaseClient } from "@supabase/supabase-js";
import { type BLEEvent, normalizeBleEvent } from "./events";
import { computeEventKey } from "./dedupe";
import { applyBleEvent } from "./applyBleEvent";
import { incBleReplayMetric } from "./metrics";
import { SCALE_BLE_REPLAY_FETCH_LIMIT, SCALE_BLE_REPLAY_APPLY_BATCH } from "@/lib/scaleConstants";

const STORAGE_KEY = "foxpro_ble_replay_history";
const CHECKPOINT_KEY_PREFIX = "foxpro_ble_replay_checkpoint_";

/** Max events kept in replay history (localStorage). */
export const MAX_HISTORY = 50;
/** Max events to process in one replay batch (prevents UI freeze). Uses scale constant. */
export const MAX_REPLAY_BATCH = SCALE_BLE_REPLAY_APPLY_BATCH;

/** Safe replay limit to avoid freezing UI (recovery procedure). Uses scale constant. */
export const REPLAY_LIMIT = SCALE_BLE_REPLAY_FETCH_LIMIT;

/** Stable checkpoint: last applied event_id or timestamp to avoid double-apply. */
export type BleReplayCheckpoint = { last_event_id?: string; last_ts?: number };

export function getBleReplayCheckpoint(storeId: string | number): BleReplayCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY_PREFIX + String(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { last_event_id?: string; last_ts?: number };
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function setBleReplayCheckpoint(storeId: string | number, cp: BleReplayCheckpoint): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHECKPOINT_KEY_PREFIX + String(storeId), JSON.stringify(cp));
  } catch {
    // ignore
  }
}

/**
 * Fetch recent BLE events from DB for recovery (store-scoped, ordered newest-first).
 * Uses REPLAY_LIMIT cap. Never throws; returns [] on error.
 */
export async function fetchRecentBleEvents(
  supabase: SupabaseClient,
  storeId: string | number,
  options?: { limit?: number }
): Promise<BLEEvent[]> {
  const limit = Math.min(REPLAY_LIMIT, Math.max(1, options?.limit ?? REPLAY_LIMIT));
  try {
    let rows: unknown[] = [];
    const qCreated = supabase
      .from("ble_events")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const resCreated = await qCreated;
    if (!resCreated?.error) {
      rows = Array.isArray(resCreated?.data) ? resCreated.data : [];
    }
    if (rows.length === 0) {
      const qTs = supabase
        .from("ble_events")
        .select("*")
        .eq("store_id", storeId)
        .order("ts", { ascending: false })
        .limit(limit);
      const resTs = await qTs;
      rows = Array.isArray(resTs?.data) ? resTs.data : [];
    }
    const normalized: BLEEvent[] = [];
    const expectedStoreId = storeId;
    for (const raw of rows) {
      const e = normalizeBleEvent(raw, { expected_store_id: expectedStoreId });
      if (e) normalized.push(e);
    }
    return normalized;
  } catch {
    return [];
  }
}

/**
 * Recovery procedure: on app start / reconnect — fetch recent events, dedupe, apply in order.
 * Uses stable checkpoint so recovery does not double-apply. Capped by REPLAY_LIMIT.
 * Debug-only counters: replayedEventsCount, appliedSessionsCount.
 * Never throws; returns false on any failure so caller can fallback to normal DB fetch.
 */
export async function runBleRecovery(args: {
  supabase: SupabaseClient;
  storeId: string | number;
  pushLog?: (msg: string) => void;
}): Promise<boolean> {
  const { supabase, storeId, pushLog } = args;
  try {
    const rawList = await fetchRecentBleEvents(supabase, storeId, { limit: REPLAY_LIMIT });
    const checkpoint = getBleReplayCheckpoint(storeId);

    // Dedupe by event key (keep first occurrence when walking oldest-first)
    const seenKeys = new Set<string>();
    const deduped: BLEEvent[] = [];
    for (let i = rawList.length - 1; i >= 0; i--) {
      const e = rawList[i];
      const key = computeEventKey(e);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      // Skip events already applied (stable checkpoint: timestamp or last_event_id)
      if (checkpoint?.last_ts != null && typeof e.ts === "number" && e.ts <= checkpoint.last_ts) continue;
      if (checkpoint?.last_event_id && e.event_id && String(e.event_id).trim() === String(checkpoint.last_event_id).trim())
        continue;
      deduped.push(e);
    }

    // Apply in deterministic order (ts asc, sequence asc), cap at MAX_REPLAY_BATCH to prevent UI freeze
    const sorted = [...deduped].sort(compareBleEventOrder);
    const toApply = sorted.slice(0, MAX_REPLAY_BATCH);
    let lastEventId: string | undefined;
    let lastTs: number | undefined;
    for (const e of toApply) {
      applyBleEvent(e, { expectedStoreId: storeId });
      incBleReplayMetric("replayedEventsCount");
      if (e.event_type === "ENTER" || e.event_type === "EXIT") incBleReplayMetric("appliedSessionsCount");
      if (e.event_id) lastEventId = e.event_id;
      if (typeof e.ts === "number") lastTs = e.ts;
    }
    if (lastEventId !== undefined || lastTs !== undefined) {
      setBleReplayCheckpoint(storeId, { last_event_id: lastEventId, last_ts: lastTs });
    }
    return true;
  } catch {
    pushLog?.("[BLE_RECOVERY_FAIL]");
    return false;
  }
}

export function getBleHistory(): BLEEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw ? JSON.parse(raw) : []) as BLEEvent[];
  } catch {
    return [];
  }
}

/** Ordering rule: timestamp ascending, then sequence when present, then event_id. */
export function compareBleEventOrder(a: BLEEvent, b: BLEEvent): number {
  const ta = typeof a.ts === "number" ? a.ts : 0;
  const tb = typeof b.ts === "number" ? b.ts : 0;
  if (ta !== tb) return ta - tb;
  const sa = typeof a.sequence === "number" ? a.sequence : 0;
  const sb = typeof b.sequence === "number" ? b.sequence : 0;
  if (sa !== sb) return sa - sb;
  const idA = (a.event_id ?? "").toString();
  const idB = (b.event_id ?? "").toString();
  return idA.localeCompare(idB);
}

/** Returns at most MAX_REPLAY_BATCH events in replay order (ts asc, sequence asc). */
export function getBleHistoryCapped(): BLEEvent[] {
  const all = getBleHistory();
  const sorted = [...all].sort(compareBleEventOrder);
  return sorted.slice(0, MAX_REPLAY_BATCH);
}

export function addToBleHistory(event: BLEEvent): void {
  if (typeof window === "undefined") return;

  const history = getBleHistory();
  // Dedupe: skip if same key as most recent (avoids replay bloat from duplicate payloads)
  const key = computeEventKey(event);
  if (history.length > 0 && computeEventKey(history[0]) === key) return;

  history.unshift(event);
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearBleHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
