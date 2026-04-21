
import { normalizeTagId } from "./normalizeTagId";
import { pushLog } from "./log";

export type BLEEventType = "ENTER" | "EXIT" | "HEARTBEAT" | "UNKNOWN";
export type BLEEventSource = "gateway" | "android" | "manual";

/**
 * ✅ Standardized BLE event shape used by the frontend.
 * This is the ONLY event model UI/business logic should rely on.
 */
export interface BLEEvent {
  store_id: string | number;
  room_id: string | number | null; // may be null for HEARTBEAT/UNKNOWN
  tag_id: string; // normalized
  rssi?: number;
  ts: number; // epoch ms
  event_type: BLEEventType;
  source: BLEEventSource;
  /**
   * Optional idempotency key (preferred dedupe key when present).
   * Forward-compatible with gateway/server contracts.
   */
  event_id?: string;

  /**
   * Optional sequence for ordering (timestamp + sequence when present).
   * Used for deterministic replay order.
   */
  sequence?: number;

  // optional diagnostic fields (ignored by business logic)
  device_id?: string;
  dedupe_key?: string;
  raw?: unknown;
}

type NormalizeOptions = {
  expected_store_id?: string | number | null | undefined;
  /**
   * If not provided, defaults to global BLE logger `pushLog`.
   * Must accept a single string (requirement: pushLog("[GUARD_BLE_SCOPE]")).
   */
  pushLog?: (msg: string) => void;
};

function normalizeEventType(input: unknown): BLEEventType {
  const t = String(input ?? "").toUpperCase().trim();
  if (t === "ENTER") return "ENTER";
  if (t === "EXIT") return "EXIT";
  if (t === "HEARTBEAT") return "HEARTBEAT";
  // Legacy/unsupported kinds (e.g. MOVE) collapse into UNKNOWN
  return "UNKNOWN";
}

function normalizeSource(input: unknown): BLEEventSource {
  const s = String(input ?? "").toLowerCase().trim();
  if (s === "gateway") return "gateway";
  if (s === "android") return "android";
  if (s === "manual") return "manual";

  // Legacy sources from older pipelines
  if (s === "real") return "gateway";
  if (s === "dev" || s === "mock") return "manual";

  // Unknown -> manual (lowest trust, but deterministic)
  return "manual";
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function normalizeTsMs(raw: any): number {
  const ts =
    toFiniteNumber(raw?.ts_ms) ??
    toFiniteNumber(raw?.tsMs) ??
    toFiniteNumber(raw?.ts) ??
    Date.now();
  // ensure integer-ish ms
  return Math.floor(ts);
}

/**
 * Canonical normalizer for incoming BLE events (from DB / socket / manual injection).
 * Used by BLE recovery for the recent-events window (fetch → dedupe → apply).
 * Never throws; returns null on invalid input or scope mismatch.
 * Requirement: `normalizeBleEvent(raw): BLEEvent | null`
 */
export function normalizeBleEvent(raw: unknown, options?: NormalizeOptions): BLEEvent | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const input: any = raw;

    const event_type = normalizeEventType(input.event_type ?? input.kind ?? input.type ?? input.event);

    const rawTag = input.tag_id ?? input.tagId;
    if (!rawTag || typeof rawTag !== "string") return null;
    const tag_id = normalizeTagId(rawTag);

    const store_id = input.store_id ?? input.storeId;
    if (store_id === null || store_id === undefined || String(store_id).trim() === "") return null;

    const ts = normalizeTsMs(input);

    // room_id mapping (accept room_no aliases)
    const room_id = input.room_id ?? input.roomId ?? input.room_no ?? input.roomNo ?? null;

    // rssi optional
    const rssi = toFiniteNumber(input.rssi);

    const source = normalizeSource(input.source);
    const device_id = input.device_id ?? input.deviceId;
    const event_id_raw = input.event_id ?? input.eventId ?? input.id;
    const event_id = typeof event_id_raw === "string" && event_id_raw.trim() ? event_id_raw.trim() : undefined;

    const e: BLEEvent = {
      store_id,
      room_id,
      tag_id,
      ...(rssi === null ? {} : { rssi }),
      ts,
      event_type,
      source,
      ...(device_id ? { device_id: String(device_id) } : {}),
      ...(event_id ? { event_id } : {}),
      dedupe_key: `${event_type}:${tag_id}:${ts}`,
      raw
    };

    // Scope guard (drop + pushLog)
    const expected = options?.expected_store_id;
    if (expected !== null && expected !== undefined && String(expected).trim() !== "") {
      const exp = String(expected).trim();
      const got = String(e.store_id).trim();
      if (exp !== got) {
        const logFn = options?.pushLog ?? pushLog;
        logFn("[GUARD_BLE_SCOPE]");
        return null;
      }
    }

    return e;
  } catch {
    const logFn = options?.pushLog ?? pushLog;
    logFn("[BLE_NORMALIZE_FAIL]");
    return null;
  }
}

/**
 * Backward-compatible alias (older code used `toBleEvent`).
 */
export const toBleEvent = normalizeBleEvent;

