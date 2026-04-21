import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import { logAuthRouteDebug } from "@/lib/security/safeAuthDebug";
import { calculateGatewayHealth } from "@/lib/ble/gateway/calculateGatewayHealth";
import { isDebugBleGatewaysEnabled, isDebugCounterPerfEnabled } from "@/lib/debug/serverDebug";

export const dynamic = "force-dynamic";

const HEARTBEAT_ALIVE_WINDOW_MS = 60_000;
const BLE_GATEWAYS_CACHE_TTL_MS = 60000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

type GatewayRow = {
  gateway_id: string;
  gateway_type: string;
  display_name: string | null;
  room_uuid: string | null;
  store_uuid: string | null;
  is_active: boolean;
};

const bleGatewaysResponseCache = new Map<string, { at: number; rows: any[] }>();
const bleGatewaysDebugOnce = new Set<string>();
const GATEWAY_BASE_SELECT = "gateway_id, gateway_type, room_uuid, store_uuid, is_active";
const GATEWAY_SELECT_WITH_DISPLAY_NAME = `${GATEWAY_BASE_SELECT}, display_name`;
const GATEWAY_SELECT_WITH_SECRET = `${GATEWAY_SELECT_WITH_DISPLAY_NAME}, gateway_secret`;
const GATEWAY_BASE_SELECT_WITH_SECRET = `${GATEWAY_BASE_SELECT}, gateway_secret`;
let bleGatewayDisplayNameStatus: "unknown" | "supported" | "missing" = "unknown";
let bleSecurityEventsStatus: "unknown" | "supported" | "missing" = "unknown";

function getErrorText(error: unknown): string {
  const message = String((error as any)?.message ?? error ?? "");
  const details = String((error as any)?.details ?? "");
  const hint = String((error as any)?.hint ?? "");
  return [message, details, hint].filter(Boolean).join(" ").trim();
}

function isMissingDisplayNameError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("display_name") && (text.includes("column") || text.includes("schema cache"));
}

function isMissingSecurityEventsError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const text = getErrorText(error).toLowerCase();
  const looksMissing =
    code === "PGRST205" ||
    code === "42P01" ||
    text.includes("schema cache") ||
    text.includes("could not find the table") ||
    text.includes("does not exist");
  return looksMissing && text.includes("ble_security_events");
}

function logBleGatewaysTrace(payload: Record<string, unknown>): void {
  if (!isDebugBleGatewaysEnabled()) return;
  console.info("[BLE_GATEWAYS_TRACE]", payload);
}

function logBleGatewaysOnce(key: string, payload: Record<string, unknown>): void {
  if (!isDebugBleGatewaysEnabled() || bleGatewaysDebugOnce.has(key)) return;
  bleGatewaysDebugOnce.add(key);
  console.info("[BLE_GATEWAYS_TRACE]", payload);
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  let authMs = 0;
  let profileMs = 0;
  let storeScopeMs = 0;
  let query1Ms = 0;
  let query2Ms = 0;
  let transformMs = 0;
  let resultCount = 0;
  let profileStoreUuid: string | null = null;
  let gatewayIdFilter: string | null = null;
  try {
    const authStartedAt = Date.now();
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/gateways",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;
    authMs = Date.now() - authStartedAt;
    const { supabase, profile } = ctx;
    const profileStartedAt = Date.now();
    profileStoreUuid =
      typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    logAuthRouteDebug("/api/ops/ble/gateways", {
      profileId: profile?.id ?? null,
      storeUuid: profileStoreUuid || null,
    });
    profileMs = Date.now() - profileStartedAt;
    if (!isUuid(profileStoreUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }
    const storeScopeStartedAt = Date.now();
    const url = new URL(req.url);
    gatewayIdFilter = String(url.searchParams.get("gateway_id") ?? "").trim();
    storeScopeMs = Date.now() - storeScopeStartedAt;
    const cacheKey = `${profileStoreUuid}|${gatewayIdFilter || "all"}`;
    const cached = bleGatewaysResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.at < BLE_GATEWAYS_CACHE_TTL_MS) {
      resultCount = Array.isArray(cached.rows) ? cached.rows.length : 0;
      if (isDebugCounterPerfEnabled()) {
        console.info("[PERF_COUNTER_BLE_GATEWAYS]", {
          auth_ms: authMs,
          profile_ms: profileMs,
          store_scope_ms: storeScopeMs,
          query_1_ms: query1Ms,
          query_2_ms: query2Ms,
          transform_ms: transformMs,
          total_ms: Date.now() - startedAt,
          result_count: resultCount,
          cache_hit: true,
        });
      }
      return NextResponse.json({ ok: true, rows: cached.rows }, { status: 200 });
    }
    let query = supabase
      .from("ble_gateways")
      .select(bleGatewayDisplayNameStatus === "missing" ? GATEWAY_BASE_SELECT : GATEWAY_SELECT_WITH_DISPLAY_NAME)
      .eq("store_uuid", profileStoreUuid)
      .order("gateway_id", { ascending: true });
    if (gatewayIdFilter) {
      query = query.eq("gateway_id", gatewayIdFilter);
    }
    const query1StartedAt = Date.now();
    const gatewayRes = await query;
    let gatewayErr = gatewayRes.error;
    let gatewayRows = Array.isArray(gatewayRes.data) ? (gatewayRes.data as unknown as GatewayRow[]) : [];
    if (!gatewayErr && bleGatewayDisplayNameStatus === "unknown") {
      bleGatewayDisplayNameStatus = "supported";
    }
    if (gatewayErr && isMissingDisplayNameError(gatewayErr)) {
      bleGatewayDisplayNameStatus = "missing";
      logBleGatewaysOnce("display_name_missing", {
        step: "ble_gateways_display_name_disabled",
        message: String(gatewayErr.message ?? gatewayErr),
        code: (gatewayErr as any)?.code ?? null,
      });
      let fallbackQuery = supabase
        .from("ble_gateways")
        .select(GATEWAY_BASE_SELECT)
        .eq("store_uuid", profileStoreUuid)
        .order("gateway_id", { ascending: true });
      if (gatewayIdFilter) {
        fallbackQuery = fallbackQuery.eq("gateway_id", gatewayIdFilter);
      }
      const fallbackRes = await fallbackQuery;
      gatewayErr = fallbackRes.error;
      gatewayRows = Array.isArray(fallbackRes.data)
        ? (fallbackRes.data as Array<Omit<GatewayRow, "display_name">>).map((row) => ({
            ...row,
            display_name: null,
          }))
        : [];
    }
    query1Ms = Date.now() - query1StartedAt;

    if (gatewayErr) {
      console.error("[BLE_GATEWAYS_QUERY_ERROR]", {
        stage: "ble_gateways",
        message: String(gatewayErr.message ?? gatewayErr),
        code: (gatewayErr as any)?.code ?? null,
        profile_store_uuid: profileStoreUuid,
        gateway_id_filter: gatewayIdFilter || null,
      });
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: String(gatewayErr.message ?? gatewayErr) },
        { status: 500 }
      );
    }

    const rows = gatewayRows;
    const gatewayIds = rows
      .map((row) => String(row.gateway_id ?? "").trim())
      .filter((id) => id !== "");
    const roomUuids = Array.from(new Set(rows.map((r) => r.room_uuid).filter(isUuid))) as string[];

    const heartbeatByGatewayId = new Map<string, string>();
    const heartbeatFallbackByGatewayId = new Map<string, string>();
    const ingestByGatewayId = new Map<string, string>();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const securityByGatewayId = new Map<string, { count: number; rate_limited: number; last_at: string | null }>();
    const roomByUuid = new Map<string, { room_no: number }>();
    const query2StartedAt = Date.now();
    const [heartbeatRes, ingestRes, securityRes, roomRes] = await Promise.all([
      gatewayIds.length > 0
        ? supabase
            .from("ble_gateway_heartbeats")
            .select("gateway_id, observed_at, status")
            .in("gateway_id", gatewayIds)
            .order("observed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      gatewayIds.length > 0
        ? supabase
            .from("ble_ingest_events")
            .select("gateway_id, observed_at")
            .in("gateway_id", gatewayIds)
            .order("observed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      gatewayIds.length > 0 && bleSecurityEventsStatus !== "missing"
        ? supabase
            .from("ble_security_events")
            .select("gateway_id, code, occurred_at")
            .in("gateway_id", gatewayIds)
            .gte("occurred_at", oneHourAgo)
        : Promise.resolve({ data: [], error: null } as any),
      roomUuids.length > 0
        ? supabase
            .from("rooms")
            .select("id, room_no")
            .in("id", roomUuids)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    query2Ms = Date.now() - query2StartedAt;
    if (heartbeatRes.error) {
      console.error("[BLE_GATEWAYS_QUERY_ERROR]", {
        stage: "ble_gateway_heartbeats",
        message: String(heartbeatRes.error.message ?? heartbeatRes.error),
        code: (heartbeatRes.error as any)?.code ?? null,
        profile_store_uuid: profileStoreUuid,
        gateway_count: gatewayIds.length,
      });
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: String(heartbeatRes.error.message ?? heartbeatRes.error) },
        { status: 500 }
      );
    }
    if (ingestRes.error) {
      console.warn("[BLE_GATEWAYS_QUERY_WARN]", {
        stage: "ble_ingest_events",
        message: String(ingestRes.error.message ?? ingestRes.error),
        code: (ingestRes.error as any)?.code ?? null,
        profile_store_uuid: profileStoreUuid,
        gateway_count: gatewayIds.length,
      });
    }
    let securityRows = Array.isArray(securityRes.data) ? securityRes.data : [];
    if (!securityRes.error && bleSecurityEventsStatus === "unknown") {
      bleSecurityEventsStatus = "supported";
    }
    if (securityRes.error && isMissingSecurityEventsError(securityRes.error)) {
      bleSecurityEventsStatus = "missing";
      securityRows = [];
      logBleGatewaysOnce("security_events_missing", {
        step: "ble_security_events_disabled",
        message: String(securityRes.error.message ?? securityRes.error),
        code: (securityRes.error as any)?.code ?? null,
      });
    } else if (securityRes.error) {
      console.warn("[BLE_GATEWAYS_QUERY_WARN]", {
        stage: "ble_security_events",
        message: String(securityRes.error.message ?? securityRes.error),
        code: (securityRes.error as any)?.code ?? null,
        profile_store_uuid: profileStoreUuid,
        gateway_count: gatewayIds.length,
      });
    }
    if (roomRes.error) {
      console.error("[BLE_GATEWAYS_QUERY_ERROR]", {
        stage: "rooms",
        message: String(roomRes.error.message ?? roomRes.error),
        code: (roomRes.error as any)?.code ?? null,
        profile_store_uuid: profileStoreUuid,
        room_uuid_count: roomUuids.length,
      });
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: String(roomRes.error.message ?? roomRes.error) },
        { status: 500 }
      );
    }
    for (const row of Array.isArray(heartbeatRes.data) ? heartbeatRes.data : []) {
      const gatewayId = String((row as any)?.gateway_id ?? "").trim();
      const observedAt = String((row as any)?.observed_at ?? "").trim();
      const status = String((row as any)?.status ?? "").trim().toLowerCase();
      if (!gatewayId || !observedAt) continue;
      if (!heartbeatFallbackByGatewayId.has(gatewayId)) {
        heartbeatFallbackByGatewayId.set(gatewayId, observedAt);
      }
      if (status === "alive" && !heartbeatByGatewayId.has(gatewayId)) {
        heartbeatByGatewayId.set(gatewayId, observedAt);
      }
    }
    for (const [gatewayId, observedAt] of Array.from(heartbeatFallbackByGatewayId.entries())) {
      if (!heartbeatByGatewayId.has(gatewayId)) {
        heartbeatByGatewayId.set(gatewayId, observedAt);
      }
    }
    for (const row of Array.isArray(ingestRes.data) ? ingestRes.data : []) {
      const gatewayId = String((row as any)?.gateway_id ?? "").trim();
      const observedAt = String((row as any)?.observed_at ?? "").trim();
      if (!gatewayId || !observedAt || ingestByGatewayId.has(gatewayId)) continue;
      ingestByGatewayId.set(gatewayId, observedAt);
    }
    for (const row of securityRows) {
      const gatewayId = String((row as any)?.gateway_id ?? "").trim();
      const code = String((row as any)?.code ?? "").trim();
      const occurredAt = String((row as any)?.occurred_at ?? "").trim();
      if (!gatewayId) continue;
      const current = securityByGatewayId.get(gatewayId) ?? { count: 0, rate_limited: 0, last_at: null };
      current.count += 1;
      if (code === "BLE_INGEST_RATE_LIMITED") current.rate_limited += 1;
      if (!current.last_at || occurredAt > current.last_at) current.last_at = occurredAt;
      securityByGatewayId.set(gatewayId, current);
    }
    for (const row of Array.isArray(roomRes.data) ? roomRes.data : []) {
      const id = String((row as any)?.id ?? "").trim();
      if (!isUuid(id)) continue;
      roomByUuid.set(id, {
        room_no: Number((row as any)?.room_no ?? 0),
      });
    }

    logBleGatewaysTrace({
      stage: "before_transform",
      profile_store_uuid: profileStoreUuid,
      gateway_id_filter: gatewayIdFilter || null,
      gateway_count: rows.length,
      heartbeat_count: heartbeatByGatewayId.size,
      ingest_count: ingestByGatewayId.size,
      security_count: securityByGatewayId.size,
      room_count: roomByUuid.size,
    });
    const nowMs = Date.now();
    const transformStartedAt = Date.now();
    const responseRows = rows.map((row) => {
      const gatewayId = String(row.gateway_id ?? "").trim();
      const lastHeartbeatAt = heartbeatByGatewayId.get(gatewayId) ?? null;
      const lastIngestAt = ingestByGatewayId.get(gatewayId) ?? null;
      const securityInfo = securityByGatewayId.get(gatewayId) ?? { count: 0, rate_limited: 0, last_at: null };

      const health = calculateGatewayHealth({
        last_heartbeat_at: lastHeartbeatAt,
        last_ingest_at: lastIngestAt,
        recent_security_issues: securityInfo.count,
        recent_rate_limited: securityInfo.rate_limited,
      });

      const heartbeatMs = lastHeartbeatAt ? Date.parse(lastHeartbeatAt) : Number.NaN;
      const heartbeatAlive =
        Number.isFinite(heartbeatMs) && Math.abs(nowMs - heartbeatMs) <= HEARTBEAT_ALIVE_WINDOW_MS;

      const roomUuid = isUuid(row.room_uuid) ? String(row.room_uuid).trim() : null;
      const roomInfo = roomUuid ? roomByUuid.get(roomUuid) : null;

      return {
        gateway_id: gatewayId,
        gateway_type: String(row.gateway_type ?? "").trim(),
        display_name: String(row.display_name ?? "").trim() || null,
        room_uuid: roomUuid,
        room_no: roomInfo?.room_no ?? null,
        room_label: null,
        store_uuid: isUuid(row.store_uuid) ? String(row.store_uuid).trim() : null,
        is_active: Boolean(row.is_active),
        last_heartbeat_at: lastHeartbeatAt,
        last_ingest_at: lastIngestAt,
        heartbeat_alive: heartbeatAlive,
        heartbeat_age_sec: health.heartbeat_age_sec,
        ingest_age_sec: health.ingest_age_sec,
        health_status: health.health_status,
        operator_hint: health.operator_hint,
        recent_security_issues: securityInfo.count,
        recent_rate_limited: securityInfo.rate_limited,
        last_security_issue_at: securityInfo.last_at,
      };
    });
    transformMs = Date.now() - transformStartedAt;
    resultCount = responseRows.length;
    bleGatewaysResponseCache.set(cacheKey, { at: Date.now(), rows: responseRows });
    if (bleGatewaysResponseCache.size > 100) {
      const firstKey = bleGatewaysResponseCache.keys().next().value as string | undefined;
      if (firstKey) bleGatewaysResponseCache.delete(firstKey);
    }
    if (isDebugCounterPerfEnabled()) {
      console.info("[PERF_COUNTER_BLE_GATEWAYS]", {
        auth_ms: authMs,
        profile_ms: profileMs,
        store_scope_ms: storeScopeMs,
        query_1_ms: query1Ms,
        query_2_ms: query2Ms,
        transform_ms: transformMs,
        total_ms: Date.now() - startedAt,
        result_count: resultCount,
        cache_hit: false,
      });
    }

    return NextResponse.json({ ok: true, rows: responseRows }, { status: 200 });
  } catch (errorLike) {
    console.error("[BLE_GATEWAYS_EXCEPTION]", {
      message: errorLike instanceof Error ? errorLike.message : String(errorLike),
      stack: errorLike instanceof Error ? errorLike.stack ?? null : null,
      profile_store_uuid: profileStoreUuid,
      gateway_id_filter: gatewayIdFilter,
    });
    throw errorLike;
  }
}

export async function POST(req: Request) {
  const ctx = await requireRouteRole({
    req,
    route: "/api/ops/ble/gateways",
    roles: ["admin", "store_owner", "manager", "counter", "ops"],
  });
  if ("response" in ctx) return ctx.response;
  const { supabase, profile } = ctx;
  const profileStoreUuid =
    typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
  logAuthRouteDebug("/api/ops/ble/gateways", {
    profileId: profile?.id ?? null,
    storeUuid: profileStoreUuid || null,
  });
  if (!isUuid(profileStoreUuid)) {
    return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | {
        gateway_id?: unknown;
        gateway_type?: unknown;
        display_name?: unknown;
        room_uuid?: unknown;
        is_active?: unknown;
      }
    | null;
  const gatewayId = String(body?.gateway_id ?? "").trim();
  const gatewayType = String(body?.gateway_type ?? "").trim() || "generic";
  const displayName = String(body?.display_name ?? "").trim() || null;
  const roomUuidRaw = String(body?.room_uuid ?? "").trim();
  const roomUuid = roomUuidRaw && isUuid(roomUuidRaw) ? roomUuidRaw : null;
  const isActive = typeof body?.is_active === "boolean" ? body.is_active : true;
  if (!gatewayId) {
    return NextResponse.json({ ok: false, error: "GATEWAY_ID_REQUIRED" }, { status: 400 });
  }
  const gatewaySecret = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  let insertPayload: Record<string, unknown> = {
    gateway_id: gatewayId,
    gateway_type: gatewayType,
    room_uuid: roomUuid,
    store_uuid: profileStoreUuid,
    is_active: isActive,
    gateway_secret: gatewaySecret,
  };
  if (bleGatewayDisplayNameStatus !== "missing") {
    insertPayload.display_name = displayName;
  }
  let insertRes = await supabase
    .from("ble_gateways")
    .insert(insertPayload)
    .select(bleGatewayDisplayNameStatus === "missing" ? GATEWAY_BASE_SELECT_WITH_SECRET : GATEWAY_SELECT_WITH_SECRET)
    .maybeSingle();
  if (insertRes.error && isMissingDisplayNameError(insertRes.error)) {
    bleGatewayDisplayNameStatus = "missing";
    logBleGatewaysOnce("display_name_missing", {
      step: "ble_gateways_display_name_disabled",
      message: String(insertRes.error.message ?? insertRes.error),
      code: (insertRes.error as any)?.code ?? null,
    });
    insertRes = await supabase
      .from("ble_gateways")
      .insert({
        gateway_id: gatewayId,
        gateway_type: gatewayType,
        room_uuid: roomUuid,
        store_uuid: profileStoreUuid,
        is_active: isActive,
        gateway_secret: gatewaySecret,
      })
      .select(GATEWAY_BASE_SELECT_WITH_SECRET)
      .maybeSingle();
  } else if (!insertRes.error && bleGatewayDisplayNameStatus === "unknown") {
    bleGatewayDisplayNameStatus = "supported";
  }
  const inserted = insertRes.data;
  const error = insertRes.error;
  if (error) {
    const code = String((error as any)?.code ?? "");
    if (code === "23505") {
      return NextResponse.json({ ok: false, error: "GATEWAY_ID_DUPLICATED" }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: String(error.message ?? error) },
      { status: 500 }
    );
  }
  for (const key of Array.from(bleGatewaysResponseCache.keys())) {
    if (key.startsWith(`${profileStoreUuid}|`)) bleGatewaysResponseCache.delete(key);
  }
  return NextResponse.json(
    {
      ok: true,
      row: {
        gateway_id: String((inserted as any)?.gateway_id ?? "").trim(),
        gateway_type: String((inserted as any)?.gateway_type ?? "").trim(),
        display_name: String((inserted as any)?.display_name ?? "").trim() || null,
        room_uuid: isUuid((inserted as any)?.room_uuid) ? String((inserted as any).room_uuid).trim() : null,
        store_uuid: isUuid((inserted as any)?.store_uuid) ? String((inserted as any).store_uuid).trim() : null,
        is_active: Boolean((inserted as any)?.is_active),
        gateway_secret: String((inserted as any)?.gateway_secret ?? "").trim(),
        last_heartbeat_at: null,
        heartbeat_alive: false,
      },
      warning: "GATEWAY_SECRET_SHOWN_ONCE_ONLY",
    },
    { status: 200 }
  );
}

export async function PATCH(req: Request) {
  const ctx = await requireRouteRole({
    req,
    route: "/api/ops/ble/gateways",
    roles: ["admin", "store_owner", "manager", "counter", "ops"],
  });
  if ("response" in ctx) return ctx.response;
  const { supabase, profile } = ctx;
  const profileStoreUuid =
    typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
  logAuthRouteDebug("/api/ops/ble/gateways", {
    profileId: profile?.id ?? null,
    storeUuid: profileStoreUuid || null,
  });
  if (!isUuid(profileStoreUuid)) {
    return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | {
        gateway_id?: unknown;
        gateway_type?: unknown;
        display_name?: unknown;
        room_uuid?: unknown;
        is_active?: unknown;
      }
    | null;
  const gatewayId = String(body?.gateway_id ?? "").trim();
  if (!gatewayId) {
    return NextResponse.json({ ok: false, error: "GATEWAY_ID_REQUIRED" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (body && Object.prototype.hasOwnProperty.call(body, "gateway_type")) {
    patch.gateway_type = String(body.gateway_type ?? "").trim() || "generic";
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "display_name") && bleGatewayDisplayNameStatus !== "missing") {
    patch.display_name = String(body.display_name ?? "").trim() || null;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "room_uuid")) {
    const roomUuidRaw = String(body.room_uuid ?? "").trim();
    patch.room_uuid = roomUuidRaw && isUuid(roomUuidRaw) ? roomUuidRaw : null;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "is_active")) {
    patch.is_active = Boolean(body.is_active);
  }
  if (Object.keys(patch).length <= 0) {
    if (body && Object.prototype.hasOwnProperty.call(body, "display_name") && bleGatewayDisplayNameStatus === "missing") {
      const currentRes = await supabase
        .from("ble_gateways")
        .select(GATEWAY_BASE_SELECT)
        .eq("store_uuid", profileStoreUuid)
        .eq("gateway_id", gatewayId)
        .maybeSingle();
      if (currentRes.error) {
        return NextResponse.json(
          { ok: false, error: "DB_ERROR", message: String(currentRes.error.message ?? currentRes.error) },
          { status: 500 }
        );
      }
      if (!currentRes.data) {
        return NextResponse.json({ ok: false, error: "GATEWAY_NOT_FOUND" }, { status: 404 });
      }
      return NextResponse.json(
        {
          ok: true,
          row: {
            gateway_id: String((currentRes.data as any)?.gateway_id ?? "").trim(),
            gateway_type: String((currentRes.data as any)?.gateway_type ?? "").trim(),
            display_name: null,
            room_uuid: isUuid((currentRes.data as any)?.room_uuid) ? String((currentRes.data as any).room_uuid).trim() : null,
            store_uuid: isUuid((currentRes.data as any)?.store_uuid) ? String((currentRes.data as any).store_uuid).trim() : null,
            is_active: Boolean((currentRes.data as any)?.is_active),
          },
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: "EMPTY_PATCH" }, { status: 400 });
  }
  let updateRes = await supabase
    .from("ble_gateways")
    .update(patch)
    .eq("store_uuid", profileStoreUuid)
    .eq("gateway_id", gatewayId)
    .select(bleGatewayDisplayNameStatus === "missing" ? GATEWAY_BASE_SELECT : GATEWAY_SELECT_WITH_DISPLAY_NAME)
    .maybeSingle();
  if (updateRes.error && isMissingDisplayNameError(updateRes.error)) {
    bleGatewayDisplayNameStatus = "missing";
    logBleGatewaysOnce("display_name_missing", {
      step: "ble_gateways_display_name_disabled",
      message: String(updateRes.error.message ?? updateRes.error),
      code: (updateRes.error as any)?.code ?? null,
    });
    const fallbackPatch = { ...patch };
    delete fallbackPatch.display_name;
    if (Object.keys(fallbackPatch).length <= 0) {
      updateRes = await supabase
        .from("ble_gateways")
        .select(GATEWAY_BASE_SELECT)
        .eq("store_uuid", profileStoreUuid)
        .eq("gateway_id", gatewayId)
        .maybeSingle();
    } else {
      updateRes = await supabase
        .from("ble_gateways")
        .update(fallbackPatch)
        .eq("store_uuid", profileStoreUuid)
        .eq("gateway_id", gatewayId)
        .select(GATEWAY_BASE_SELECT)
        .maybeSingle();
    }
  } else if (!updateRes.error && bleGatewayDisplayNameStatus === "unknown") {
    bleGatewayDisplayNameStatus = "supported";
  }
  const updated = updateRes.data;
  const error = updateRes.error;
  if (error) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: String(error.message ?? error) },
      { status: 500 }
    );
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "GATEWAY_NOT_FOUND" }, { status: 404 });
  }
  for (const key of Array.from(bleGatewaysResponseCache.keys())) {
    if (key.startsWith(`${profileStoreUuid}|`)) bleGatewaysResponseCache.delete(key);
  }
  return NextResponse.json(
    {
      ok: true,
      row: {
        gateway_id: String((updated as any)?.gateway_id ?? "").trim(),
        gateway_type: String((updated as any)?.gateway_type ?? "").trim(),
        display_name: String((updated as any)?.display_name ?? "").trim() || null,
        room_uuid: isUuid((updated as any)?.room_uuid) ? String((updated as any).room_uuid).trim() : null,
        store_uuid: isUuid((updated as any)?.store_uuid) ? String((updated as any).store_uuid).trim() : null,
        is_active: Boolean((updated as any)?.is_active),
      },
    },
    { status: 200 }
  );
}

