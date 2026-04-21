import { applyBleSignal, bleTick } from "@/lib/counterStore";
import { makeEnter, makeExit } from "@/lib/ble/mockFeed";
import type { BLEEvent } from "./events";
import { isDuplicateBleEvent } from "./dedupe";
import {
  incBleDiagReceived,
  incBleDiagDeduped,
  incBleDiagApplied,
  logBleDiagSummaryAndReset
} from "./diagnostics";
import { featureFlags } from "@/lib/config/featureFlags";

export type ApplyBleEventOptions = {
  /** When set, event is dropped if store_id does not match (no cross-store bleed). */
  expectedStoreId?: string | number | null;
};

/** Ordering rule: ts asc, sequence asc, event_id (used for batch replay). */
function compareBleEventOrder(a: BLEEvent, b: BLEEvent): number {
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

/** Re-entrancy guard: prevents runaway if applyBleSignal/bleTick triggers another apply. */
let applying = false;

/**
 * Adapter function to connect BleEvent to existing BLE signal processing.
 * Idempotent: duplicates are ignored. Store-scoped when expectedStoreId is provided.
 */
export function applyBleEvent(
  event: BLEEvent,
  options?: ApplyBleEventOptions
): void {
  if (applying) return;
  const isDebug = Boolean(featureFlags.enableDebugMode);
  incBleDiagReceived(1);

  // Store scope: drop events for other stores (no cross-store bleed).
  const expected = options?.expectedStoreId;
  if (expected !== null && expected !== undefined && String(expected).trim() !== "") {
    const exp = String(expected).trim();
    const got = String(event.store_id ?? "").trim();
    if (exp !== got) {
      logBleDiagSummaryAndReset(isDebug);
      return;
    }
  }

  applying = true;
  try {
    const now = event.ts;

    // Idempotency: ignore duplicates safely.
    if (isDuplicateBleEvent(event)) {
      incBleDiagDeduped(1);
      logBleDiagSummaryAndReset(isDebug);
      return;
    }

    // Convert BleEvent to BleSignal based on kind
    let signal;
    if (event.event_type === "ENTER") {
      if (!event.room_id) {
        logBleDiagSummaryAndReset(isDebug);
        return;
      }
      signal = makeEnter(event.tag_id, String(event.room_id), now);
    } else if (event.event_type === "EXIT") {
      if (!event.room_id) {
        logBleDiagSummaryAndReset(isDebug);
        return;
      }
      signal = makeExit(event.tag_id, String(event.room_id), now);
    } else {
      logBleDiagSummaryAndReset(isDebug);
      return;
    }

    applyBleSignal(signal);
    bleTick(now);
    incBleDiagApplied(1);
  } finally {
    applying = false;
  }
  logBleDiagSummaryAndReset(isDebug);
}

/** Max events to process per batch to avoid runaway loops (replay/bulk ingest). */
export const MAX_BLE_BATCH_SIZE = 100;

/**
 * Batch version: applies events in deterministic order (ts asc, sequence asc).
 * Capped to MAX_BLE_BATCH_SIZE. Does not mutate the input array.
 */
export function applyBleEvents(
  events: readonly BLEEvent[],
  options?: ApplyBleEventOptions
): void {
  const sorted = [...events].sort(compareBleEventOrder);
  const batch = sorted.slice(0, MAX_BLE_BATCH_SIZE);
  for (const event of batch) {
    applyBleEvent(event, options);
  }
}
