export type BleIngestEventType = "enter" | "leave" | "heartbeat";

export type BleIngestEventInput = {
  beacon_minor: number;
  event_type: BleIngestEventType;
  rssi: number | null;
  observed_at: string;
};

export type BleIngestPayload = {
  gateway_id: string;
  events: BleIngestEventInput[];
};

export type ParseBleIngestResult =
  | { ok: true; payload: BleIngestPayload }
  | { ok: false; error: string };

const EVENT_TYPES: Record<BleIngestEventType, true> = {
  enter: true,
  leave: true,
  heartbeat: true,
};

const TIMESTAMP_MAX_FUTURE_MS = 5 * 60 * 1000;
const TIMESTAMP_MAX_PAST_MS = 24 * 60 * 60 * 1000;

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function toIso(v: unknown, now: number = Date.now()): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  if (!text) return null;
  const d = new Date(text);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  const diff = ms - now;
  if (diff > TIMESTAMP_MAX_FUTURE_MS) return null;
  if (diff < -TIMESTAMP_MAX_PAST_MS) return null;
  return d.toISOString();
}

export function parseBleIngestPayload(raw: unknown): ParseBleIngestResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "INVALID_BODY" };
  const body = raw as Record<string, unknown>;
  const gatewayId = typeof body.gateway_id === "string" ? body.gateway_id.trim() : "";
  if (!gatewayId) return { ok: false, error: "GATEWAY_ID_REQUIRED" };

  const eventsRaw = body.events;
  if (!Array.isArray(eventsRaw)) return { ok: false, error: "EVENTS_REQUIRED" };
  if (eventsRaw.length <= 0 || eventsRaw.length > 200) return { ok: false, error: "EVENTS_LENGTH_INVALID" };

  const now = Date.now();
  const events: BleIngestEventInput[] = [];
  for (let i = 0; i < eventsRaw.length; i += 1) {
    const row = eventsRaw[i];
    if (!row || typeof row !== "object") return { ok: false, error: `EVENT_INVALID_${i}` };
    const r = row as Record<string, unknown>;
    const minor = toInt(r.beacon_minor);
    if (!Number.isFinite(minor)) return { ok: false, error: `BEACON_MINOR_INVALID_${i}` };
    const eventTypeRaw = typeof r.event_type === "string" ? r.event_type.trim().toLowerCase() : "";
    if (!eventTypeRaw || !(eventTypeRaw in EVENT_TYPES)) return { ok: false, error: `EVENT_TYPE_INVALID_${i}` };
    const observedAt = toIso(r.observed_at, now);
    if (!observedAt) return { ok: false, error: `OBSERVED_AT_INVALID_OR_OUT_OF_RANGE_${i}` };
    const rssiNum = r.rssi == null ? null : toInt(r.rssi);
    const rssi = rssiNum == null || Number.isNaN(rssiNum) ? null : rssiNum;
    events.push({
      beacon_minor: minor,
      event_type: eventTypeRaw as BleIngestEventType,
      rssi,
      observed_at: observedAt,
    });
  }

  return {
    ok: true,
    payload: {
      gateway_id: gatewayId,
      events,
    },
  };
}

