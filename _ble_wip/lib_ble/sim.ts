/**
 * FOX PRO / M5-2-4 — DEV BLE EVENT SIMULATOR (NO UI TEXT CHANGE)
 *
 * Dev-only helper to push BLE events into the ingest pipeline without real hardware.
 *
 * Exposes (dev only):
 *   window.__FOXPRO_BLE_PUSH__(eventOrBatch)
 *   - POSTs JSON to `/api/ble/ingest`
 *
 * Example (DevTools console):
 *
 *   // Single event (will be wrapped into { store_id, events: [event] })
 *   await window.__FOXPRO_BLE_PUSH__({
 *     store_id: "store_magok",
 *     room_no: "101",
 *     tag_id: "aa:bb:cc:11:22:33",
 *     event_type: "ENTER",
 *     rssi: -62,
 *     ts: 1705824000123,
 *     event_id: "7c0c7dfc-4f2e-4f7f-9c33-1e1f0b2b7f0a"
 *   });
 *
 *   // Or full batch payload (sent as-is):
 *   await window.__FOXPRO_BLE_PUSH__({
 *     store_id: "store_magok",
 *     events: [
 *       {
 *         store_id: "store_magok",
 *         room_no: "101",
 *         tag_id: "aa:bb:cc:11:22:33",
 *         event_type: "EXIT",
 *         ts: "2026-01-29T12:05:10.999Z"
 *       }
 *     ]
 *   });
 */

declare global {
  interface Window {
    __FOXPRO_BLE_PUSH__?: (eventOrBatch: unknown) => Promise<unknown>;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toIngestBody(eventOrBatch: unknown): unknown {
  // If caller passes full batch payload: { store_id, events: [...] }
  if (isRecord(eventOrBatch) && Array.isArray((eventOrBatch as any).events) && (eventOrBatch as any).store_id) {
    return eventOrBatch;
  }

  // If caller passes an array of events: [{...}, {...}]
  if (Array.isArray(eventOrBatch)) {
    const first = eventOrBatch[0] as any;
    const store_id = first?.store_id ?? first?.storeId ?? first?.store;
    return { store_id, events: eventOrBatch };
  }

  // Otherwise treat as single event object.
  if (isRecord(eventOrBatch)) {
    const store_id = (eventOrBatch as any).store_id ?? (eventOrBatch as any).storeId ?? (eventOrBatch as any).store;
    return { store_id, events: [eventOrBatch] };
  }

  return { store_id: null, events: [eventOrBatch] };
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep as text
  }

  if (!res.ok) {
    const err = new Error(`BLE ingest failed: ${res.status} ${res.statusText}`);
    (err as any).status = res.status;
    (err as any).body = parsed;
    throw err;
  }

  return parsed;
}

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  // eslint-disable-next-line no-underscore-dangle
  window.__FOXPRO_BLE_PUSH__ = async (eventOrBatch: unknown) => {
    const body = toIngestBody(eventOrBatch);
    return await postJson("/api/ble/ingest", body);
  };
}

export {};

