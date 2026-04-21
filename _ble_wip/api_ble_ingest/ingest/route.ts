import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAnonSupabaseOrError } from "@/lib/supabaseServer";
import { parseBleIngestPayload, type BleIngestEventInput } from "@/lib/ble/ingest/parseBleIngestPayload";
import { processBleIngest } from "@/lib/ble/ingest/processBleIngest";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { opsLog } from "@/lib/ops/logger";
import { writeBleSecurityEvent } from "@/lib/ble/logging/writeBleSecurityEvent";
import { emitAutomationAlert } from "@/lib/automation/alertHooks";
import { shouldAlertRepeatedFailure } from "@/lib/ble/security/alertThreshold";
import { isDebugBleInferenceEnabled } from "@/lib/debug/serverDebug";

export const dynamic = "force-dynamic";

const BLE_INGEST_RATE_LIMIT = 60;
const BLE_INGEST_WINDOW_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeError(e: unknown): string {
  if (typeof (e as any)?.message === "string") return String((e as any).message);
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "UNKNOWN_ERROR";
  }
}

type MappingGatewayRow = {
  gateway_id: string | null;
  store_uuid: string | null;
  room_uuid: string | null;
  room_name: string | null;
  is_active: boolean | null;
};

type MappingTagRow = {
  beacon_minor: number;
  hostess_id: string | null;
  hostess_uuid: string | null;
  is_active: boolean | null;
  store_uuid: string | null;
};

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function asTrimmedText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  return text.length > 0 ? text : null;
}

function buildPresenceMeta(existingMeta: unknown, roomName: string | null): Record<string, unknown> {
  const meta =
    existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)
      ? { ...(existingMeta as Record<string, unknown>) }
      : {};

  if (roomName) {
    meta.room_name = roomName;
  }

  return meta;
}

function logBleMappingTrace(input: {
  gateway_id: string;
  room_uuid: string | null;
  room_name: string | null;
  beacon_minor: number;
  hostess_id: string | null;
  mapping_applied: boolean;
  reason: string;
}) {
  console.info("[BLE_MAPPING_TRACE]", input);
}

function logBleIngestTrace(step: string, payload: Record<string, unknown>) {
  console.info("[BLE_INGEST_TRACE]", {
    step,
    ...payload,
  });
}

function logBleIngestDbTrace(step: string, payload: Record<string, unknown>) {
  console.info("[BLE_INGEST_DB_TRACE]", {
    step,
    ...payload,
  });
}

function logBleIngestErrorTrace(step: string, payload: Record<string, unknown>) {
  console.error("[BLE_INGEST_ERROR_TRACE]", {
    step,
    ...payload,
  });
}

async function syncHostessPresenceFromIngest(
  supabase: SupabaseClient,
  gatewayId: string,
  events: BleIngestEventInput[]
): Promise<void> {
  if (events.length <= 0) return;

  const { data: gatewayRaw, error: gatewayErr } = await supabase
    .from("ble_gateways")
    .select("*")
    .eq("gateway_id", gatewayId)
    .maybeSingle();

  if (gatewayErr || !gatewayRaw) {
    for (const event of events) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: null,
        room_name: null,
        beacon_minor: Math.trunc(Number(event.beacon_minor)),
        hostess_id: null,
        mapping_applied: false,
        reason: gatewayErr ? "gateway_lookup_failed" : "gateway_not_found",
      });
    }
    return;
  }

  const gateway = gatewayRaw as MappingGatewayRow;
  const storeUuid = isUuid(gateway.store_uuid) ? String(gateway.store_uuid).trim() : null;
  const roomUuid = isUuid(gateway.room_uuid) ? String(gateway.room_uuid).trim() : null;
  const roomName = asTrimmedText((gatewayRaw as any).room_name);

  const minors = Array.from(
    new Set(
      events
        .map((event) => Math.trunc(Number(event.beacon_minor)))
        .filter((minor) => Number.isFinite(minor) && minor > 0)
    )
  );

  const tagMap = new Map<number, MappingTagRow[]>();
  if (storeUuid && minors.length > 0) {
    const { data: tagRows, error: tagErr } = await supabase
      .from("ble_tags")
      .select("beacon_minor, hostess_id, hostess_uuid, is_active, store_uuid")
      .eq("is_active", true)
      .in("beacon_minor", minors);

    if (tagErr) {
      for (const event of events) {
        logBleMappingTrace({
          gateway_id: gatewayId,
          room_uuid: roomUuid,
          room_name: roomName,
          beacon_minor: Math.trunc(Number(event.beacon_minor)),
          hostess_id: null,
          mapping_applied: false,
          reason: "tag_lookup_failed",
        });
      }
      return;
    }

    for (const row of Array.isArray(tagRows) ? (tagRows as MappingTagRow[]) : []) {
      if (!Number.isFinite(Number((row as any)?.beacon_minor))) continue;
      const minor = Math.trunc(Number((row as any).beacon_minor));
      const existing = tagMap.get(minor) ?? [];
      existing.push(row);
      tagMap.set(minor, existing);
    }
  }

  for (const event of events) {
    const beaconMinor = Math.trunc(Number(event.beacon_minor));

    if (!Number.isFinite(beaconMinor) || beaconMinor === 0) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: Number.isFinite(beaconMinor) ? beaconMinor : 0,
        hostess_id: null,
        mapping_applied: false,
        reason: "zero_minor_ignored",
      });
      continue;
    }

    if (event.event_type === "leave") {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: null,
        mapping_applied: false,
        reason: "leave_event_ignored",
      });
      continue;
    }

    if (!storeUuid) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: null,
        mapping_applied: false,
        reason: "gateway_store_uuid_missing",
      });
      continue;
    }

    if (!roomUuid) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: null,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: null,
        mapping_applied: false,
        reason: "gateway_room_uuid_missing",
      });
      continue;
    }

    const tagCandidates = tagMap.get(beaconMinor) ?? [];
    const tag =
      tagCandidates.find((row) => isUuid(row.store_uuid) && String(row.store_uuid).trim() === storeUuid) ??
      tagCandidates.find((row) => !asTrimmedText(row.store_uuid)) ??
      null;

    if (!tag) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: null,
        mapping_applied: false,
        reason: tagCandidates.length > 0 ? "tag_out_of_store_scope" : "tag_not_found",
      });
      continue;
    }

    const hostessId = isUuid(tag.hostess_id)
      ? String(tag.hostess_id).trim()
      : isUuid(tag.hostess_uuid)
        ? String(tag.hostess_uuid).trim()
        : null;

    if (!hostessId) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: null,
        mapping_applied: false,
        reason: "hostess_not_mapped",
      });
      continue;
    }

    const nowIso = new Date().toISOString();
    const { data: activeRow, error: activeErr } = await supabase
      .from("hostess_presence")
      .select("id, meta")
      .eq("hostess_id", hostessId)
      .is("left_at", null)
      .maybeSingle();

    if (activeErr) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: hostessId,
        mapping_applied: false,
        reason: "presence_lookup_failed",
      });
      continue;
    }

    const updatePayload = {
      last_seen_at: event.observed_at,
      updated_at: nowIso,
      presence_status: "present",
      gateway_id: gatewayId,
      beacon_minor: beaconMinor,
      store_uuid: storeUuid,
      room_uuid: roomUuid,
      meta: buildPresenceMeta((activeRow as any)?.meta ?? null, roomName),
    };

    if (activeRow) {
      const { error: updateErr } = await supabase
        .from("hostess_presence")
        .update(updatePayload)
        .eq("id", String((activeRow as any).id ?? ""));

      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: hostessId,
        mapping_applied: !updateErr,
        reason: updateErr ? "presence_update_failed" : "presence_updated",
      });
      continue;
    }

    const { error: insertErr } = await supabase.from("hostess_presence").insert({
      hostess_id: hostessId,
      beacon_minor: beaconMinor,
      gateway_id: gatewayId,
      store_uuid: storeUuid,
      room_uuid: roomUuid,
      entered_at: event.observed_at,
      left_at: null,
      last_seen_at: event.observed_at,
      presence_status: "present",
      updated_at: nowIso,
      meta: buildPresenceMeta(null, roomName),
    });

    if (!insertErr) {
      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: hostessId,
        mapping_applied: true,
        reason: "presence_inserted",
      });
      continue;
    }

    if (String((insertErr as any)?.code ?? "") === "23505") {
      const { data: retryRow, error: retryErr } = await supabase
        .from("hostess_presence")
        .select("id, meta")
        .eq("hostess_id", hostessId)
        .is("left_at", null)
        .maybeSingle();

      if (!retryErr && retryRow) {
        const { error: retryUpdateErr } = await supabase
          .from("hostess_presence")
          .update({
            ...updatePayload,
            meta: buildPresenceMeta((retryRow as any)?.meta ?? null, roomName),
          })
          .eq("id", String((retryRow as any).id ?? ""));

        logBleMappingTrace({
          gateway_id: gatewayId,
          room_uuid: roomUuid,
          room_name: roomName,
          beacon_minor: beaconMinor,
          hostess_id: hostessId,
          mapping_applied: !retryUpdateErr,
          reason: retryUpdateErr ? "presence_retry_update_failed" : "presence_updated_after_conflict",
        });
        continue;
      }

      logBleMappingTrace({
        gateway_id: gatewayId,
        room_uuid: roomUuid,
        room_name: roomName,
        beacon_minor: beaconMinor,
        hostess_id: hostessId,
        mapping_applied: false,
        reason: "presence_retry_lookup_failed",
      });
      continue;
    }

    logBleMappingTrace({
      gateway_id: gatewayId,
      room_uuid: roomUuid,
      room_name: roomName,
      beacon_minor: beaconMinor,
      hostess_id: hostessId,
      mapping_applied: false,
      reason: "presence_insert_failed",
    });
  }
}

export async function POST(req: Request) {
  const reqStartedAt = Date.now();
  const sb = getAnonSupabaseOrError();
  const supabase = "error" in sb ? null : sb.supabase;
  logBleIngestTrace("request_start", {
    route: "/api/ble/ingest",
    has_supabase_client: Boolean(supabase),
  });

  const gatewayKey = req.headers.get("x-gateway-key");
  if (!gatewayKey || typeof gatewayKey !== "string" || gatewayKey.trim().length <= 0) {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    opsLog.security("BLE_INGEST_AUTH_MISSING", {
      route: "/api/ble/ingest",
      detail: { ip, user_agent: userAgent },
    });
    void writeBleSecurityEvent(supabase, {
      code: "BLE_INGEST_AUTH_MISSING",
      route: "/api/ble/ingest",
      ip,
      user_agent: userAgent,
    });
    return NextResponse.json(
      {
        ok: false,
        gateway_id: "",
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: "GATEWAY_AUTH_REQUIRED",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: unknown = null;
  try {
    logBleIngestTrace("request_body_parse_start", {
      route: "/api/ble/ingest",
      content_type: req.headers.get("content-type") ?? null,
      content_length: req.headers.get("content-length") ?? null,
      has_gateway_key: Boolean(gatewayKey && gatewayKey.trim()),
    });
    body = await req.json();
    const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const bodyEvents = Array.isArray(bodyRecord?.events) ? bodyRecord?.events : [];
    logBleIngestTrace("request_body_parse_success", {
      gateway_id_hint: typeof bodyRecord?.gateway_id === "string" ? bodyRecord.gateway_id.trim() : null,
      event_count: bodyEvents.length,
      first_event_minor:
        bodyEvents.length > 0 ? Number((bodyEvents[0] as Record<string, unknown> | null)?.beacon_minor ?? NaN) : null,
    });
  } catch (e) {
    logBleIngestErrorTrace("request_body_parse_failed", {
      reason: "invalid_json",
      error: normalizeError(e),
    });
    return NextResponse.json(
      {
        ok: false,
        gateway_id: "",
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: `INVALID_JSON:${normalizeError(e)}`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseStartedAt = Date.now();
  const parsed = parseBleIngestPayload(body);
  const parseMs = Date.now() - parseStartedAt;
  logBleIngestTrace("payload_parse_result", {
    ok: parsed.ok,
    parse_ms: parseMs,
    gateway_id_hint: typeof (body as any)?.gateway_id === "string" ? String((body as any).gateway_id).trim() : null,
    event_count_hint: Array.isArray((body as any)?.events) ? (body as any).events.length : null,
  });
  if (!parsed.ok) {
    const gatewayIdHint = typeof (body as any)?.gateway_id === "string" ? String((body as any).gateway_id).trim() : "";
    if (parsed.error.includes("OBSERVED_AT_INVALID_OR_OUT_OF_RANGE")) {
      opsLog.security("BLE_INGEST_TIMESTAMP_INVALID", {
        route: "/api/ble/ingest",
        detail: { gateway_id_hint: gatewayIdHint, error: parsed.error },
      });
      void writeBleSecurityEvent(supabase, {
        code: "BLE_INGEST_TIMESTAMP_INVALID",
        route: "/api/ble/ingest",
        gateway_id: gatewayIdHint || null,
        detail: { error: parsed.error },
      });
    }
    return NextResponse.json(
      {
        ok: false,
        gateway_id: gatewayIdHint,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: parsed.error,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if ("error" in sb) return sb.error;

  const authStartedAt = Date.now();
  const svcUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!svcUrl || !svcKey) {
    return NextResponse.json(
      {
        ok: false,
        gateway_id: parsed.payload.gateway_id,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: "GATEWAY_AUTH_LOOKUP_FAIL:SUPABASE_SERVICE_ROLE_KEY_MISSING",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  const svcSupabase = createClient(svcUrl, svcKey, {
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
  const { data: authGateway, error: authErr } = await svcSupabase
    .from("ble_gateways")
    .select("gateway_id,is_active,store_uuid")
    .eq("gateway_secret", gatewayKey.trim())
    .maybeSingle();
  logBleIngestDbTrace("gateway_lookup_by_secret", {
    gateway_id_from_payload: parsed.payload.gateway_id,
    matched_gateway_id: String((authGateway as any)?.gateway_id ?? "").trim() || null,
    store_uuid: String((authGateway as any)?.store_uuid ?? "").trim() || null,
    is_active: (authGateway as any)?.is_active ?? null,
    lookup_error: authErr ? String(authErr.message ?? authErr) : null,
  });

  if (authErr) {
    logBleIngestErrorTrace("gateway_lookup_by_secret_failed", {
      reason: "gateway_lookup_error",
      gateway_id_from_payload: parsed.payload.gateway_id,
      error: String(authErr.message ?? authErr),
    });
    return NextResponse.json(
      {
        ok: false,
        gateway_id: parsed.payload.gateway_id,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: `GATEWAY_AUTH_LOOKUP_FAIL:${String(authErr.message ?? authErr)}`,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (process.env.NODE_ENV !== "production") {
    const row = authGateway as { gateway_id?: string; is_active?: boolean; store_uuid?: string } | null;
    console.info("[BLE_INGEST_AUTH]", {
      hasGatewayKey: true,
      matchedGatewayId: row?.gateway_id ?? null,
      isActive: row?.is_active ?? null,
      storeUuid: row?.store_uuid ?? null,
      authMode: "service_role",
    });
  }

  if (!authGateway) {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    opsLog.security("BLE_INGEST_AUTH_INVALID", {
      route: "/api/ble/ingest",
      detail: {
        gateway_id_hint: parsed.payload.gateway_id,
        ip,
        user_agent: userAgent,
      },
    });
    void writeBleSecurityEvent(supabase, {
      code: "BLE_INGEST_AUTH_INVALID",
      route: "/api/ble/ingest",
      gateway_id: parsed.payload.gateway_id,
      ip,
      user_agent: userAgent,
    });
    const thresholdKey = `ble:threshold:auth_invalid:ip:${ip}`;
    const shouldAlert = await shouldAlertRepeatedFailure(thresholdKey, supabase).catch(() => false);
    if (shouldAlert) {
      void emitAutomationAlert(
        {
          type: "BLE_SECURITY_AUTH_ATTACK",
          message: `Repeated BLE auth failures from IP ${ip} (>5 in 5min)`,
          detail: { ip, gateway_id_hint: parsed.payload.gateway_id },
        },
        undefined,
        supabase
      );
    }
    return NextResponse.json(
      {
        ok: false,
        gateway_id: parsed.payload.gateway_id,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: "GATEWAY_AUTH_INVALID",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if ((authGateway as any).is_active === false) {
    const authenticatedGatewayId = String((authGateway as any).gateway_id ?? "").trim();
    const authStoreUuid = String((authGateway as any).store_uuid ?? "").trim() || null;
    opsLog.security("BLE_INGEST_GATEWAY_INACTIVE", {
      route: "/api/ble/ingest",
      detail: { gateway_id: authenticatedGatewayId },
    });
    void writeBleSecurityEvent(supabase, {
      code: "BLE_INGEST_GATEWAY_INACTIVE",
      route: "/api/ble/ingest",
      gateway_id: authenticatedGatewayId,
      store_uuid: authStoreUuid,
    });
    return NextResponse.json(
      {
        ok: false,
        gateway_id: authenticatedGatewayId,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: "GATEWAY_INACTIVE",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authenticatedGatewayId = String((authGateway as any).gateway_id ?? "").trim();
  const authStoreUuid = String((authGateway as any).store_uuid ?? "").trim() || null;
  logBleIngestTrace("gateway_lookup_resolved", {
    payload_gateway_id: parsed.payload.gateway_id,
    authenticated_gateway_id: authenticatedGatewayId,
    store_uuid: authStoreUuid,
    is_active: (authGateway as any).is_active ?? null,
  });
  
  if (parsed.payload.gateway_id !== authenticatedGatewayId) {
    opsLog.security("BLE_INGEST_GATEWAY_MISMATCH", {
      route: "/api/ble/ingest",
      detail: {
        payload_gateway_id: parsed.payload.gateway_id,
        auth_gateway_id: authenticatedGatewayId,
      },
    });
    void writeBleSecurityEvent(supabase, {
      code: "BLE_INGEST_GATEWAY_MISMATCH",
      route: "/api/ble/ingest",
      gateway_id: authenticatedGatewayId,
      store_uuid: authStoreUuid,
      detail: {
        payload_gateway_id: parsed.payload.gateway_id,
        auth_gateway_id: authenticatedGatewayId,
      },
    });
    void emitAutomationAlert(
      {
        type: "BLE_SECURITY_GATEWAY_MISMATCH",
        message: `Gateway ID spoofing attempt: payload=${parsed.payload.gateway_id}, auth=${authenticatedGatewayId}`,
        detail: {
          payload_gateway_id: parsed.payload.gateway_id,
          auth_gateway_id: authenticatedGatewayId,
          gateway_id: authenticatedGatewayId,
        },
      },
      undefined,
      supabase
    );
    return NextResponse.json(
      {
        ok: false,
        gateway_id: authenticatedGatewayId,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: `GATEWAY_ID_MISMATCH:payload=${parsed.payload.gateway_id},auth=${authenticatedGatewayId}`,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const ip = getClientIp(req);
  const rateLimitDecision = checkRateLimit({
    key: {
      route: "/api/ble/ingest",
      userId: authenticatedGatewayId,
      ip,
      scope: "gateway",
    },
    limit: BLE_INGEST_RATE_LIMIT,
    window_ms: BLE_INGEST_WINDOW_MS,
  });

  if (!rateLimitDecision.ok) {
    opsLog.security("BLE_INGEST_RATE_LIMITED", {
      route: "/api/ble/ingest",
      detail: {
        gateway_id: authenticatedGatewayId,
        retry_after_sec: rateLimitDecision.retry_after_sec,
        ip,
      },
    });
    void writeBleSecurityEvent(supabase, {
      code: "BLE_INGEST_RATE_LIMITED",
      route: "/api/ble/ingest",
      gateway_id: authenticatedGatewayId,
      store_uuid: authStoreUuid,
      ip,
      detail: {
        retry_after_sec: rateLimitDecision.retry_after_sec,
      },
    });
    const rateLimitKey = `ble:threshold:rate_limited:gateway:${authenticatedGatewayId}`;
    const shouldAlertRateLimit = await shouldAlertRepeatedFailure(rateLimitKey, supabase).catch(() => false);
    if (shouldAlertRateLimit) {
      void emitAutomationAlert(
        {
          type: "BLE_SECURITY_RATE_BURST",
          message: `Gateway ${authenticatedGatewayId} repeatedly rate-limited (>5 in 5min)`,
          detail: { gateway_id: authenticatedGatewayId, ip },
        },
        undefined,
        supabase
      );
    }
    return NextResponse.json(
      {
        ok: false,
        gateway_id: authenticatedGatewayId,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: `RATE_LIMITED:retry_after=${rateLimitDecision.retry_after_sec}s`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitDecision.retry_after_sec),
          "Cache-Control": "no-store",
        },
      }
    );
  }
  const authMs = Date.now() - authStartedAt;

  try {
    logBleIngestTrace("process_ble_ingest_start", {
      gateway_id: parsed.payload.gateway_id,
      authenticated_gateway_id: authenticatedGatewayId,
      store_uuid: authStoreUuid,
      event_count: parsed.payload.events.length,
      beacon_minor_list: parsed.payload.events.map((event) => Math.trunc(Number(event.beacon_minor ?? 0))),
    });
    const result = await processBleIngest(sb.supabase, parsed.payload);
    logBleIngestTrace("process_ble_ingest_result", {
      gateway_id: parsed.payload.gateway_id,
      ok: result.ok,
      processed: result.processed,
      inserted_events: result.inserted_events,
      presence_updates: result.presence_updates,
      warnings_count: Array.isArray(result.warnings) ? result.warnings.length : 0,
      error: result.error ?? null,
    });
    if (isDebugBleInferenceEnabled()) {
      const perf = result.perf ?? {
        insert_ms: 0,
        presence_ms: 0,
        total_ms: Date.now() - reqStartedAt,
        events_count: result.processed ?? 0,
        heartbeat_count: 0,
        warnings_count: Array.isArray(result.warnings) ? result.warnings.length : 0,
      };
      console.info("[BLE_INGEST_PERF]", {
        parse_ms: parseMs,
        auth_ms: authMs,
        insert_ms: perf.insert_ms,
        presence_ms: perf.presence_ms,
        total_ms: Date.now() - reqStartedAt,
        events_count: perf.events_count,
        heartbeat_count: perf.heartbeat_count,
        warnings_count: perf.warnings_count,
      });
    }
    return NextResponse.json(result, { 
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (e) {
    logBleIngestErrorTrace("process_ble_ingest_uncaught", {
      reason: "uncaught_exception",
      gateway_id: parsed.payload.gateway_id,
      parse_ms: parseMs,
      auth_ms: authMs,
      error: normalizeError(e),
      stack: typeof (e as any)?.stack === "string" ? String((e as any).stack) : null,
    });
    return NextResponse.json(
      {
        ok: false,
        gateway_id: parsed.payload.gateway_id,
        processed: 0,
        inserted_events: 0,
        presence_updates: 0,
        warnings: [],
        error: `INGEST_UNCAUGHT:${normalizeError(e)}`,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

