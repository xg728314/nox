import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { BleIngestPayload } from "./parseBleIngestPayload";
import { applyPresenceEvent } from "./applyPresenceEvent";
import { applyZoneInference } from "@/lib/ble/inference/applyZoneInference";
import { isDebugBleInferenceEnabled } from "@/lib/debug/serverDebug";

type GatewayRow = {
  id: string | null;
  gateway_id: string;
  room_uuid: string | null;
  store_uuid: string | null;
  floor_no?: number | null;
  zone_id?: string | null;
  zone_type?: string | null;
  zone_code?: string | null;
  is_active: boolean | null;
};

type TagRow = {
  minor: number;
  hostess_id: string | null;
  is_active: boolean | null;
};

type RawTagLookupRow = {
  store_uuid?: string | null;
  minor?: number | null;
  beacon_minor?: number | null;
  hostess_id?: string | null;
  hostess_uuid?: string | null;
  is_active?: boolean | null;
};

type ExistingPresenceRow = {
  id: string;
  minor: number;
  rssi: number | null;
  last_seen_at: string | null;
  gateway_id: string | null;
  room_uuid: string | null;
};

export type ProcessBleIngestResult = {
  ok: boolean;
  gateway_id: string;
  processed: number;
  inserted_events: number;
  presence_updates: number;
  warnings: string[];
  error?: string;
  perf?: {
    insert_ms: number;
    presence_ms: number;
    total_ms: number;
    events_count: number;
    heartbeat_count: number;
    warnings_count: number;
  };
};

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function logGatewayResolve(payload: {
  gatewayIdFromPayload: string;
  matchedGatewayId: string | null;
  storeUuid: string | null;
  roomUuid: string | null;
  step: string;
  reason: string;
}) {
  if (!isDebugBleInferenceEnabled()) return;
  console.info("[BLE_INGEST_GATEWAY_RESOLVE]", payload);
}

function logZoneTrace(payload: Record<string, unknown>): void {
  if (!isDebugBleInferenceEnabled()) return;
  console.log("[ZONE_TRACE]", payload);
}

function logBleIngestTrace(step: string, payload: Record<string, unknown>): void {
  console.info("[BLE_INGEST_TRACE]", {
    step,
    ...payload,
  });
}

function logBleIngestDbTrace(step: string, payload: Record<string, unknown>): void {
  console.info("[BLE_INGEST_DB_TRACE]", {
    step,
    ...payload,
  });
}

function logBleIngestErrorTrace(step: string, payload: Record<string, unknown>): void {
  console.error("[BLE_INGEST_ERROR_TRACE]", {
    step,
    ...payload,
  });
}

function logBleGatewayLookup(payload: Record<string, unknown>): void {
  console.info("[BLE_GATEWAY_LOOKUP]", payload);
}

function logBleTagLookup(payload: Record<string, unknown>): void {
  console.info("[BLE_TAG_LOOKUP]", payload);
}

function logBlePresenceUpsert(payload: Record<string, unknown>): void {
  console.info("[BLE_PRESENCE_UPSERT]", payload);
}

function logBleRssiCompare(payload: Record<string, unknown>): void {
  console.info("[BLE_RSSI_COMPARE]", payload);
}

function logBlePresenceDecision(payload: Record<string, unknown>): void {
  console.info("[BLE_PRESENCE_DECISION]", payload);
}

function normalizeError(error: unknown): string {
  if (typeof (error as any)?.message === "string") return String((error as any).message);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "UNKNOWN_ERROR";
  }
}

function getErrorInfo(error: unknown) {
  return {
    code: String((error as any)?.code ?? ""),
    message: String((error as any)?.message ?? error ?? ""),
    details: String((error as any)?.details ?? ""),
    hint: String((error as any)?.hint ?? ""),
  };
}

function isMissingColumn(error: unknown, columnHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  return info.code === "42703" && columnHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function resolveTagMinor(row: RawTagLookupRow | null | undefined): number | null {
  const minor =
    Number.isFinite(Number(row?.minor ?? NaN))
      ? Math.trunc(Number(row?.minor))
      : Number.isFinite(Number(row?.beacon_minor ?? NaN))
        ? Math.trunc(Number(row?.beacon_minor))
        : NaN;
  return Number.isFinite(minor) && minor >= 0 ? minor : null;
}

function resolveTagHostessId(row: RawTagLookupRow | null | undefined): string | null {
  if (isUuid(row?.hostess_id)) return String(row?.hostess_id).trim();
  if (isUuid(row?.hostess_uuid)) return String(row?.hostess_uuid).trim();
  return null;
}

const BLE_PRESENCE_RSSI_STALE_MS = 10_000;
const BLE_PRESENCE_RSSI_MARGIN = 5;
const BLE_PRESENCE_ROOM_MOVE_STALE_MS = 3_000;
const BLE_PRESENCE_MIN_VALID_RSSI = -70;
const BLE_PRESENCE_MAX_DROP_DIFF = 10;

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isCounterGateway(gatewayId: unknown): boolean {
  return typeof gatewayId === "string" && gatewayId.trim().toLowerCase() === "gw-counter-01";
}

function createIngestServiceRoleClient(): SupabaseClient | null {
  const svcUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!svcUrl || !svcKey) return null;
  return createClient(svcUrl, svcKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
      },
    },
  });
}

async function loadScopedTagMap(args: {
  supabase: SupabaseClient;
  storeUuid: string;
  gatewayId: string;
  minors: number[];
}): Promise<{
  ok: true;
  tagMap: Map<number, TagRow>;
  resolvedHostessIds: string[];
} | {
  ok: false;
  error: string;
}> {
  const minors = Array.from(new Set(args.minors.filter((minor) => Number.isFinite(minor) && minor >= 0)));
  if (minors.length <= 0) {
    logBleTagLookup({
      step: "lookup_skipped",
      gateway_id: args.gatewayId,
      store_uuid: args.storeUuid,
      reason: "no_minors",
    });
    return { ok: true, tagMap: new Map<number, TagRow>(), resolvedHostessIds: [] };
  }

  let queryMode = "store_uuid+minor";
  let data: RawTagLookupRow[] = [];
  let error: unknown = null;

  let result: { data: any[] | null; error: unknown } = await args.supabase
    .from("ble_tags")
    .select("store_uuid, minor, hostess_id, is_active")
    .eq("store_uuid", args.storeUuid)
    .in("minor", minors);

  if (result.error && isMissingColumn(result.error, ["minor", "hostess_id", "store_uuid"])) {
    queryMode = "store_uuid+beacon_minor";
    result = await args.supabase
      .from("ble_tags")
      .select("store_uuid, beacon_minor, hostess_id, hostess_uuid, is_active")
      .eq("store_uuid", args.storeUuid)
      .in("beacon_minor", minors);
  }

  if (result.error && isMissingColumn(result.error, ["store_uuid", "hostess_id", "hostess_uuid"])) {
    queryMode = "legacy_beacon_minor";
    result = await args.supabase
      .from("ble_tags")
      .select("beacon_minor, hostess_id, hostess_uuid, is_active")
      .in("beacon_minor", minors);
  }

  data = Array.isArray(result.data) ? (result.data as RawTagLookupRow[]) : [];
  error = result.error;

  logBleTagLookup({
    step: "lookup_result",
    gateway_id: args.gatewayId,
    store_uuid: args.storeUuid,
    query_mode: queryMode,
    minor_count: minors.length,
    matched_count: data.length,
    error: error ? normalizeError(error) : null,
  });

  if (error) {
    return {
      ok: false,
      error: `TAG_LOOKUP_FAIL:${normalizeError(error)}`,
    };
  }

  const tagMap = new Map<number, TagRow>();
  for (const row of data) {
    const minor = resolveTagMinor(row);
    if (minor == null || tagMap.has(minor)) continue;
    const rowStoreUuid = typeof row.store_uuid === "string" ? row.store_uuid.trim() : "";
    if (rowStoreUuid && rowStoreUuid !== args.storeUuid) continue;
    tagMap.set(minor, {
      minor,
      hostess_id: resolveTagHostessId(row),
      is_active: typeof row.is_active === "boolean" ? row.is_active : null,
    });
  }

  const resolvedHostessIds = Array.from(
    new Set(
      Array.from(tagMap.values())
        .map((row) => (row.is_active === false ? null : isUuid(row.hostess_id) ? String(row.hostess_id).trim() : null))
        .filter((value): value is string => isUuid(value))
    )
  );

  return { ok: true, tagMap, resolvedHostessIds };
}

async function upsertBleTagPresence(args: {
  supabase: SupabaseClient;
  storeUuid: string | null;
  gatewayId: string;
  roomUuid: string | null;
  sortedEvents: BleIngestPayload["events"];
  tagMap: Map<number, TagRow>;
  warnings: string[];
}): Promise<void> {
  if (!isUuid(args.storeUuid)) {
    logBlePresenceUpsert({
      step: "skipped",
      gateway_id: args.gatewayId,
      room_uuid: args.roomUuid,
      reason: "store_uuid_missing_or_invalid",
    });
    return;
  }
  if (!isUuid(args.roomUuid)) {
    logBlePresenceUpsert({
      step: "skipped",
      gateway_id: args.gatewayId,
      store_uuid: args.storeUuid,
      reason: "room_uuid_missing_or_invalid",
    });
    return;
  }

  const latestByMinor = new Map<number, BleIngestPayload["events"][number]>();
  for (const event of args.sortedEvents) {
    const minor = Math.trunc(Number(event.beacon_minor ?? NaN));
    if (!Number.isFinite(minor) || minor < 0) continue;
    latestByMinor.set(minor, event);
  }
  const minors = Array.from(latestByMinor.keys());
  if (minors.length <= 0) {
    logBlePresenceUpsert({
      step: "skipped",
      gateway_id: args.gatewayId,
      store_uuid: args.storeUuid,
      room_uuid: args.roomUuid,
      reason: "no_valid_minors",
    });
    return;
  }

  const existingResult = await args.supabase
    .from("ble_tag_presence")
    .select("id, minor, rssi, last_seen_at, gateway_id, room_uuid")
    .eq("store_uuid", args.storeUuid)
    .in("minor", minors);

  if (existingResult.error) {
    const message = normalizeError(existingResult.error);
    logBlePresenceUpsert({
      step: "existing_lookup_failed",
      gateway_id: args.gatewayId,
      store_uuid: args.storeUuid,
      room_uuid: args.roomUuid,
      minor_count: minors.length,
      reason: message,
    });
    args.warnings.push(`BLE_TAG_PRESENCE_LOOKUP_FAIL:${message}`);
    return;
  }

  const existingByMinor = new Map<number, ExistingPresenceRow>();
  for (const row of Array.isArray(existingResult.data) ? existingResult.data : []) {
    const minor = Math.trunc(Number((row as any)?.minor ?? NaN));
    const id = String((row as any)?.id ?? "").trim();
    if (!Number.isFinite(minor) || !id) continue;
    existingByMinor.set(minor, {
      id,
      minor,
      rssi: toFiniteNumber((row as any)?.rssi),
      last_seen_at: typeof (row as any)?.last_seen_at === "string" ? String((row as any)?.last_seen_at).trim() : null,
      gateway_id: typeof (row as any)?.gateway_id === "string" ? String((row as any)?.gateway_id).trim() : null,
      room_uuid: typeof (row as any)?.room_uuid === "string" ? String((row as any)?.room_uuid).trim() : null,
    });
  }

  for (const [minor, event] of Array.from(latestByMinor.entries())) {
    const nowIso = new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const tag = args.tagMap.get(minor) ?? null;
    const hostessId = tag && tag.is_active === false ? null : tag?.hostess_id ?? null;
    const existing = existingByMinor.get(minor) ?? null;
    const existingId = existing?.id ?? null;
    const payload = {
      hostess_id: hostessId,
      gateway_id: args.gatewayId,
      room_uuid: args.roomUuid,
      rssi: event.rssi,
      event_type: event.event_type,
      last_seen_at: nowIso,
      updated_at: nowIso,
    };

    logBlePresenceUpsert({
      step: existingId ? "before_update" : "before_insert",
      store_uuid: args.storeUuid,
      minor,
      hostess_id: hostessId,
      gateway_id: args.gatewayId,
      room_uuid: args.roomUuid,
      rssi: event.rssi,
      event_type: event.event_type,
    });

    if (existingId) {
      const existingRssi = toFiniteNumber(existing?.rssi);
      const newRssi = toFiniteNumber(event.rssi);
      const existingLastSeenMs = toTimestampMs(existing?.last_seen_at);
      const existingAgeMs = existingLastSeenMs == null ? null : Math.max(0, nowMs - existingLastSeenMs);
      const isStale = existingAgeMs == null || existingAgeMs >= BLE_PRESENCE_RSSI_STALE_MS;
      const isSameGateway = Boolean(existing?.gateway_id && existing.gateway_id === args.gatewayId);
      const isSameRoom = Boolean(existing?.room_uuid && existing.room_uuid === args.roomUuid);
      const isMoveStale = existingAgeMs != null && existingAgeMs > BLE_PRESENCE_ROOM_MOVE_STALE_MS;
      const isStronger =
        newRssi != null && (existingRssi == null || newRssi > existingRssi + BLE_PRESENCE_RSSI_MARGIN);
      const isValidSignalForStale =
        newRssi != null &&
        newRssi >= BLE_PRESENCE_MIN_VALID_RSSI &&
        (existingRssi == null || newRssi >= existingRssi - BLE_PRESENCE_MAX_DROP_DIFF);
      const existingIsCounterGateway = isCounterGateway(existing?.gateway_id);
      const newIsCounterGateway = isCounterGateway(args.gatewayId);
      logBleRssiCompare({
        store_uuid: args.storeUuid,
        minor,
        existing_gateway_id: existing?.gateway_id ?? null,
        new_gateway_id: args.gatewayId,
        existing_room_uuid: existing?.room_uuid ?? null,
        new_room_uuid: args.roomUuid,
        existing_rssi: existingRssi,
        new_rssi: newRssi,
        existing_last_seen_at: existing?.last_seen_at ?? null,
        existing_age_ms: existingAgeMs,
        stale_after_ms: BLE_PRESENCE_RSSI_STALE_MS,
        move_stale_after_ms: BLE_PRESENCE_ROOM_MOVE_STALE_MS,
        rssi_margin: BLE_PRESENCE_RSSI_MARGIN,
        min_valid_rssi: BLE_PRESENCE_MIN_VALID_RSSI,
        max_drop_diff: BLE_PRESENCE_MAX_DROP_DIFF,
        is_stale: isStale,
        is_move_stale: isMoveStale,
        is_valid_signal_for_stale: isValidSignalForStale,
        is_same_gateway: isSameGateway,
        is_same_room: isSameRoom,
        is_stronger: isStronger,
        existing_is_counter_gateway: existingIsCounterGateway,
        new_is_counter_gateway: newIsCounterGateway,
      });

      let shouldUpdate = false;
      let decisionReason = "weaker_recent_gateway";
      if (isSameGateway) {
        shouldUpdate = true;
        decisionReason = "same_gateway_refresh";
      } else if (isSameRoom) {
        shouldUpdate = true;
        decisionReason = "same_room_refresh";
      } else if (existingIsCounterGateway && !newIsCounterGateway) {
        shouldUpdate = true;
        decisionReason = "counter_gateway_room_takeover";
      } else if (!existingIsCounterGateway && newIsCounterGateway) {
        if (isStale) {
          shouldUpdate = true;
          decisionReason = "stale_takeover";
        } else if (isStronger) {
          shouldUpdate = true;
          decisionReason = "stronger_rssi_takeover";
        } else {
          shouldUpdate = false;
          decisionReason = "counter_gateway_deprioritized";
        }
      } else if (isMoveStale && isValidSignalForStale) {
        shouldUpdate = true;
        decisionReason = "stale_room_takeover";
      } else if (isStronger) {
        shouldUpdate = true;
        decisionReason = "stronger_rssi_takeover";
      }

      logBlePresenceDecision({
        store_uuid: args.storeUuid,
        minor,
        action: shouldUpdate ? "update" : "skip",
        reason: decisionReason,
        existing_gateway_id: existing?.gateway_id ?? null,
        new_gateway_id: args.gatewayId,
        existing_room_uuid: existing?.room_uuid ?? null,
        new_room_uuid: args.roomUuid,
        existing_rssi: existingRssi,
        new_rssi: newRssi,
        existing_age_ms: existingAgeMs,
        existing_last_seen_at: existing?.last_seen_at ?? null,
        stale_after_ms: BLE_PRESENCE_RSSI_STALE_MS,
        move_stale_after_ms: BLE_PRESENCE_ROOM_MOVE_STALE_MS,
        rssi_margin: BLE_PRESENCE_RSSI_MARGIN,
        min_valid_rssi: BLE_PRESENCE_MIN_VALID_RSSI,
        max_drop_diff: BLE_PRESENCE_MAX_DROP_DIFF,
        is_stale: isStale,
        is_move_stale: isMoveStale,
        is_valid_signal_for_stale: isValidSignalForStale,
        is_same_gateway: isSameGateway,
        is_same_room: isSameRoom,
        is_stronger: isStronger,
        existing_is_counter_gateway: existingIsCounterGateway,
        new_is_counter_gateway: newIsCounterGateway,
        decision_summary:
          decisionReason === "counter_gateway_room_takeover"
            ? "existing mapping came from counter gateway; prefer room gateway takeover"
            : decisionReason === "counter_gateway_deprioritized"
              ? "current mapping is already room-scoped; ignore weaker recent counter gateway"
              : decisionReason === "stale_room_takeover"
                ? "room mapping is older than move stale window; allow room takeover"
              : decisionReason === "stale_takeover"
                ? "existing mapping expired; allow takeover"
                : decisionReason === "stronger_rssi_takeover"
                  ? "new gateway signal exceeded RSSI margin; allow takeover"
                  : decisionReason === "weaker_recent_gateway"
                    ? "existing mapping is fresher/stronger; keep current room"
                    : decisionReason === "same_gateway_refresh"
                      ? "same gateway heartbeat; refresh current mapping"
                      : "same room heartbeat; refresh current mapping",
      });

      if (!shouldUpdate) {
        logBlePresenceUpsert({
          step: "skipped_rssi_guard",
          store_uuid: args.storeUuid,
          minor,
          gateway_id: args.gatewayId,
          room_uuid: args.roomUuid,
          reason: decisionReason,
        });
        continue;
      }

      const { error } = await args.supabase
        .from("ble_tag_presence")
        .update(payload)
        .eq("id", existingId);
      if (error) {
        const message = normalizeError(error);
        logBlePresenceUpsert({
          step: "update_failed",
          store_uuid: args.storeUuid,
          minor,
          reason: message,
        });
        args.warnings.push(`BLE_TAG_PRESENCE_UPDATE_FAIL:${minor}:${message}`);
        continue;
      }
      logBlePresenceUpsert({
        step: "updated",
        store_uuid: args.storeUuid,
        minor,
      });
      continue;
    }

    const insertPayload = {
      store_uuid: args.storeUuid,
      minor,
      hostess_id: hostessId,
      gateway_id: args.gatewayId,
      room_uuid: args.roomUuid,
      rssi: event.rssi,
      event_type: event.event_type,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const { error } = await args.supabase.from("ble_tag_presence").insert(insertPayload);
    if (error) {
      const message = normalizeError(error);
      logBlePresenceUpsert({
        step: "insert_failed",
        store_uuid: args.storeUuid,
        minor,
        reason: message,
      });
      args.warnings.push(`BLE_TAG_PRESENCE_INSERT_FAIL:${minor}:${message}`);
      continue;
    }
    logBlePresenceUpsert({
      step: "inserted",
      store_uuid: args.storeUuid,
      minor,
    });
  }
}

async function applyLegacyPresenceProjection(args: {
  supabase: SupabaseClient;
  sortedEvents: BleIngestPayload["events"];
  tagMap: Map<number, TagRow>;
  gatewayId: string;
  roomUuid: string | null;
  storeUuid: string;
  warnings: string[];
}): Promise<number> {
  let presenceUpdates = 0;
  for (const event of args.sortedEvents) {
    const tag = args.tagMap.get(event.beacon_minor) ?? null;
    const tagActive = tag == null || tag.is_active !== false;
    const hostessUuid = tagActive && isUuid(tag?.hostess_id) ? String(tag?.hostess_id).trim() : null;
    const applied = await applyPresenceEvent(args.supabase, {
      hostess_uuid: hostessUuid,
      beacon_minor: event.beacon_minor,
      gateway_id: args.gatewayId,
      room_uuid: args.roomUuid,
      store_uuid: args.storeUuid,
      observed_at: event.observed_at,
      event_type: event.event_type,
    });
    presenceUpdates += Math.max(0, toInt(applied.presence_updates));
    if (applied.warning) {
      args.warnings.push(`${event.event_type.toUpperCase()}:${event.beacon_minor}:${applied.warning}`);
    }
  }
  return presenceUpdates;
}

export async function processBleIngest(
  supabase: SupabaseClient,
  payload: BleIngestPayload
): Promise<ProcessBleIngestResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const gatewayId = payload.gateway_id;
  logBleIngestTrace("process_start", {
    gateway_id: gatewayId,
    event_count: Array.isArray(payload.events) ? payload.events.length : 0,
  });

  const svcSb = createIngestServiceRoleClient();
  if (!svcSb) {
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: null,
      storeUuid: null,
      roomUuid: null,
      step: "service_role_unavailable",
      reason: "SUPABASE_SERVICE_ROLE_KEY_MISSING",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_LOOKUP_FAIL:SUPABASE_SERVICE_ROLE_KEY_MISSING",
    };
  }

  const { data: gateway, error: gatewayErr } = await svcSb
    .from("ble_gateways")
    .select("id, gateway_id, room_uuid, store_uuid, is_active")
    .eq("gateway_id", gatewayId)
    .maybeSingle();
  logBleGatewayLookup({
    step: "lookup_result",
    gateway_id: gatewayId,
    matched_gateway_id: String((gateway as any)?.gateway_id ?? "").trim() || null,
    store_uuid: String((gateway as any)?.store_uuid ?? "").trim() || null,
    room_uuid: String((gateway as any)?.room_uuid ?? "").trim() || null,
    is_active: (gateway as any)?.is_active ?? null,
    error: gatewayErr ? String(gatewayErr.message ?? gatewayErr) : null,
  });
  logBleIngestDbTrace("gateway_lookup_result", {
    gateway_id: gatewayId,
    matched_gateway_id: String((gateway as any)?.gateway_id ?? "").trim() || null,
    store_uuid: String((gateway as any)?.store_uuid ?? "").trim() || null,
    room_uuid: String((gateway as any)?.room_uuid ?? "").trim() || null,
    is_active: (gateway as any)?.is_active ?? null,
    error: gatewayErr ? String(gatewayErr.message ?? gatewayErr) : null,
  });
  if (gatewayErr) {
    logBleIngestErrorTrace("gateway_lookup_failed", {
      reason: "ble_gateways_query_error",
      gateway_id: gatewayId,
      error: String(gatewayErr.message ?? gatewayErr),
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: null,
      storeUuid: null,
      roomUuid: null,
      step: "ble_gateways_query",
      reason: String(gatewayErr.message ?? gatewayErr),
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: `GATEWAY_LOOKUP_FAIL:${String(gatewayErr.message ?? gatewayErr)}`,
    };
  }
  if (!gateway) {
    logBleIngestErrorTrace("gateway_lookup_missing", {
      reason: "no_row_for_gateway_id",
      gateway_id: gatewayId,
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: null,
      storeUuid: null,
      roomUuid: null,
      step: "ble_gateways_row",
      reason: "no_row_for_gateway_id",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_NOT_FOUND",
    };
  }
  if ((gateway as GatewayRow).is_active === false) {
    logBleIngestErrorTrace("gateway_inactive", {
      reason: "is_active_false",
      gateway_id: gatewayId,
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
      storeUuid: null,
      roomUuid: null,
      step: "gateway_active",
      reason: "is_active_false",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_INACTIVE",
    };
  }

  const rawRoom = (gateway as GatewayRow).room_uuid;
  const rawStore = (gateway as GatewayRow).store_uuid;
  const roomUuid = isUuid(rawRoom) ? String(rawRoom).trim() : null;
  const storeUuid = isUuid(rawStore) ? String(rawStore).trim() : null;
  logBleGatewayLookup({
    step: "scope_resolved",
    gateway_id: gatewayId,
    matched_gateway_id: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
    store_uuid: storeUuid,
    room_uuid: roomUuid,
  });
  logBleIngestTrace("gateway_scope_resolved", {
    gateway_id: gatewayId,
    matched_gateway_id: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
    store_uuid: storeUuid,
    room_uuid: roomUuid,
    raw_store_uuid: rawStore ?? null,
    raw_room_uuid: rawRoom ?? null,
  });

  if (!storeUuid && !roomUuid) {
    logBleIngestErrorTrace("gateway_scope_invalid", {
      reason: "store_and_room_uuid_missing_or_invalid",
      gateway_id: gatewayId,
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
      storeUuid: null,
      roomUuid: null,
      step: "uuid_mapping",
      reason: "store_and_room_uuid_missing_or_invalid",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_MAPPING_NOT_FOUND",
    };
  }
  if (!storeUuid) {
    logBleIngestErrorTrace("gateway_store_scope_invalid", {
      reason: "store_uuid_missing_or_invalid",
      gateway_id: gatewayId,
      room_uuid: roomUuid,
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
      storeUuid: null,
      roomUuid,
      step: "uuid_mapping",
      reason: "store_uuid_missing_or_invalid",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_STORE_UUID_MISSING",
    };
  }
  if (!roomUuid) {
    logBleIngestErrorTrace("gateway_room_scope_invalid", {
      reason: "room_uuid_missing_or_invalid",
      gateway_id: gatewayId,
      store_uuid: storeUuid,
    });
    logGatewayResolve({
      gatewayIdFromPayload: gatewayId,
      matchedGatewayId: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
      storeUuid,
      roomUuid: null,
      step: "uuid_mapping",
      reason: "room_uuid_missing_or_invalid",
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: "GATEWAY_ROOM_UUID_MISSING",
    };
  }

  logGatewayResolve({
    gatewayIdFromPayload: gatewayId,
    matchedGatewayId: String((gateway as GatewayRow).gateway_id ?? "").trim() || null,
    storeUuid,
    roomUuid,
    step: "ok",
    reason: "resolved",
  });

  const sortedEvents = [...payload.events].sort((a, b) => {
    const aMs = Date.parse(a.observed_at);
    const bMs = Date.parse(b.observed_at);
    return aMs - bMs;
  });
  const heartbeatCount = sortedEvents.reduce(
    (count, event) => count + (event.event_type === "heartbeat" ? 1 : 0),
    0
  );

  const minors = Array.from(new Set(sortedEvents.map((e) => e.beacon_minor)));
  logBleIngestTrace("beacon_minor_processing", {
    gateway_id: gatewayId,
    store_uuid: storeUuid,
    room_uuid: roomUuid,
    event_count: sortedEvents.length,
    heartbeat_count: heartbeatCount,
    beacon_minor_list: minors,
    event_types: sortedEvents.map((event) => ({
      beacon_minor: event.beacon_minor,
      event_type: event.event_type,
      observed_at: event.observed_at,
    })),
  });
  const tagLookup = await loadScopedTagMap({
    supabase: svcSb,
    storeUuid,
    gatewayId,
    minors,
  });
  if (!tagLookup.ok) {
    logBleIngestErrorTrace("tag_lookup_failed", {
      reason: "ble_tags_query_error",
      gateway_id: gatewayId,
      error: tagLookup.error,
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: tagLookup.error,
    };
  }
  const { tagMap, resolvedHostessIds } = tagLookup;

  const eventRows = sortedEvents.map((event) => {
    const tag = tagMap.get(event.beacon_minor) ?? null;
    const tagActive = tag == null || tag.is_active !== false;
    const hostessUuid = tagActive && isUuid(tag?.hostess_id) ? String(tag?.hostess_id).trim() : null;
    return {
      gateway_id: gatewayId,
      beacon_minor: event.beacon_minor,
      event_type: event.event_type,
      rssi: event.rssi,
      observed_at: event.observed_at,
      room_uuid: roomUuid,
      store_uuid: storeUuid,
      meta: hostessUuid ? { hostess_id: hostessUuid } : ({} as Record<string, unknown>),
    };
  });

  logBleIngestDbTrace("ble_ingest_events_insert_before", {
    gateway_id: gatewayId,
    store_uuid: storeUuid,
    room_uuid: roomUuid,
    row_count: eventRows.length,
    sample_row: eventRows[0] ?? null,
  });
  const insertStartedAt = Date.now();
  const { error: eventsInsertErr } = await supabase.from("ble_ingest_events").insert(eventRows);
  const insertMs = Date.now() - insertStartedAt;
  if (eventsInsertErr) {
    logBleIngestErrorTrace("ble_ingest_events_insert_failed", {
      reason: "insert_error",
      gateway_id: gatewayId,
      store_uuid: storeUuid,
      room_uuid: roomUuid,
      row_count: eventRows.length,
      error: String(eventsInsertErr.message ?? eventsInsertErr),
    });
    return {
      ok: false,
      gateway_id: gatewayId,
      processed: 0,
      inserted_events: 0,
      presence_updates: 0,
      warnings,
      error: `INGEST_EVENTS_INSERT_FAIL:${String(eventsInsertErr.message ?? eventsInsertErr)}`,
    };
  }
  logBleIngestDbTrace("ble_ingest_events_insert_after", {
    gateway_id: gatewayId,
    row_count: eventRows.length,
    insert_ms: insertMs,
  });

  await upsertBleTagPresence({
    supabase: svcSb,
    storeUuid,
    gatewayId,
    roomUuid,
    sortedEvents,
    tagMap,
    warnings,
  });

  let presenceUpdates = 0;
  const presenceStartedAt = Date.now();
  for (const event of sortedEvents) {
    const tag = tagMap.get(event.beacon_minor) ?? null;
    if (!tag) warnings.push(`TAG_NOT_FOUND:${event.beacon_minor}`);
    if (tag && tag.is_active === false) warnings.push(`TAG_INACTIVE:${event.beacon_minor}`);

    if (event.event_type === "heartbeat") {
      const { error: hbErr } = await supabase.from("ble_gateway_heartbeats").insert({
        gateway_id: gatewayId,
        gateway_db_id: isUuid((gateway as GatewayRow).id) ? String((gateway as GatewayRow).id).trim() : null,
        store_uuid: storeUuid,
        room_uuid: roomUuid,
        status: "tag_heartbeat",
        observed_at: event.observed_at,
        meta: { rssi: event.rssi, beacon_minor: event.beacon_minor },
      });
      if (hbErr) warnings.push(`HEARTBEAT_INSERT_FAIL:${String(hbErr.message ?? hbErr)}`);
    }
  }
  logZoneTrace({
    step: "before_apply_zone_inference",
    store_uuid: storeUuid,
    gateway_id: gatewayId,
    beacon_minor_list: minors,
    resolved_hostess_id_list: resolvedHostessIds,
    event_count: sortedEvents.length,
  });
  let zoneResult: Awaited<ReturnType<typeof applyZoneInference>>;
  try {
    zoneResult = await applyZoneInference({
      supabase: svcSb,
      storeUuid,
      events: sortedEvents,
      preloadedTags: Array.from(tagMap.values()).map((tag) => ({
        beacon_minor: tag.minor,
        hostess_id: tag.hostess_id,
        is_active: tag.is_active,
      })),
    });
  } catch (error) {
    logBleIngestErrorTrace("apply_zone_inference_failed", {
      reason: "apply_zone_inference_throw",
      gateway_id: gatewayId,
      store_uuid: storeUuid,
      room_uuid: roomUuid,
      beacon_minor_list: minors,
      error: normalizeError(error),
      stack: typeof (error as any)?.stack === "string" ? String((error as any).stack) : null,
    });
    throw error;
  }
  logZoneTrace({
    step: "after_apply_zone_inference",
    store_uuid: storeUuid,
    gateway_id: gatewayId,
    beacon_minor_list: minors,
    resolved_hostess_id_list: resolvedHostessIds,
    event_count: sortedEvents.length,
    zone_schema_detected: zoneResult.schema_detected,
    inference_applied: zoneResult.ok && !zoneResult.fallback_to_legacy,
    current_state_upsert_row_count: zoneResult.zone_state_updates,
    room_presence_update_row_count: zoneResult.room_presence_updates,
    fallback_reason: zoneResult.fallback_reason,
  });
  logZoneTrace({
    step: "zone_inference_result",
    store_uuid: storeUuid,
    gateway_id: gatewayId,
    beacon_minor_list: zoneResult.beacon_minors,
    resolved_hostess_id_list: zoneResult.affected_hostess_ids,
    event_count: sortedEvents.length,
    zone_schema_detected: zoneResult.schema_detected,
    inference_applied: zoneResult.ok && !zoneResult.fallback_to_legacy,
    current_state_upsert_row_count: zoneResult.zone_state_updates,
    room_presence_update_row_count: zoneResult.room_presence_updates,
    fallback_reason: zoneResult.fallback_reason,
    gateway_zone_join_success_count: zoneResult.gateway_zone_join_count,
    candidate_count: zoneResult.candidate_count,
  });
  if (zoneResult.ok && !zoneResult.fallback_to_legacy) {
    presenceUpdates = Math.max(0, toInt(zoneResult.room_presence_updates));
    warnings.push(...zoneResult.warnings);
  } else {
    warnings.push(...zoneResult.warnings);
    logZoneTrace({
      step: "zone_fallback_legacy_presence",
      store_uuid: storeUuid,
      gateway_id: gatewayId,
      beacon_minor_list: minors,
      resolved_hostess_id_list: resolvedHostessIds,
      event_count: sortedEvents.length,
      zone_schema_detected: zoneResult.schema_detected,
      inference_applied: false,
      current_state_upsert_row_count: zoneResult.zone_state_updates,
      room_presence_update_row_count: zoneResult.room_presence_updates,
      fallback_reason: zoneResult.fallback_reason,
    });
    presenceUpdates = await applyLegacyPresenceProjection({
      supabase,
      sortedEvents,
      tagMap,
      gatewayId,
      roomUuid,
      storeUuid,
      warnings,
    });
    logZoneTrace({
      step: "legacy_presence_applied",
      store_uuid: storeUuid,
      gateway_id: gatewayId,
      beacon_minor_list: minors,
      resolved_hostess_id_list: resolvedHostessIds,
      event_count: sortedEvents.length,
      zone_schema_detected: zoneResult.schema_detected,
      inference_applied: false,
      current_state_upsert_row_count: zoneResult.zone_state_updates,
      room_presence_update_row_count: presenceUpdates,
      fallback_reason: zoneResult.fallback_reason,
    });
  }
  const presenceMs = Date.now() - presenceStartedAt;

  return {
    ok: true,
    gateway_id: gatewayId,
    processed: sortedEvents.length,
    inserted_events: sortedEvents.length,
    presence_updates: presenceUpdates,
    warnings: Array.from(new Set(warnings)),
    perf: {
      insert_ms: insertMs,
      presence_ms: presenceMs,
      total_ms: Date.now() - startedAt,
      events_count: sortedEvents.length,
      heartbeat_count: heartbeatCount,
      warnings_count: warnings.length,
    },
  };
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

