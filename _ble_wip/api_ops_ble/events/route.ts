import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_EVENT_TYPES = new Set(["enter", "leave", "heartbeat"]);

function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function parseLimit(value: string | null): number {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

function getErrorInfo(error: unknown) {
  return {
    code: String((error as any)?.code ?? ""),
    message: String((error as any)?.message ?? error ?? ""),
    details: String((error as any)?.details ?? ""),
    hint: String((error as any)?.hint ?? ""),
  };
}

function isMissingTableOrSchemaCache(error: unknown, resourceHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  const missingKind =
    info.code === "PGRST205" ||
    info.code === "42P01" ||
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table");
  return missingKind && resourceHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function isMissingColumn(error: unknown, columnHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  return info.code === "42703" && columnHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function logEventsQueryIssue(
  level: "warn" | "error",
  stage: string,
  error: unknown,
  context: Record<string, unknown>
) {
  const info = getErrorInfo(error);
  const payload = {
    stage,
    code: info.code || null,
    message: info.message || null,
    details: info.details || null,
    hint: info.hint || null,
    ...context,
  };
  if (level === "warn") {
    console.warn("[BLE_EVENTS_QUERY_WARN]", payload);
    return;
  }
  console.error("[BLE_EVENTS_QUERY_ERROR]", payload);
}

function toMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET(req: Request) {
  try {
    console.log("[BLE_EVENTS_TRACE]", {
      step: "start",
      route: "/api/ops/ble/events",
    });
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/events",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;
    const { supabase, profile, context } = ctx;
    const profileStoreUuid =
      typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    console.log("[BLE_EVENTS_TRACE]", {
      step: "after_auth",
      auth_user_id: context.user.id ?? null,
      profile_id: profile?.id ?? null,
      profile_role: profile?.role ?? null,
      profile_store_uuid: profileStoreUuid || null,
    });
    console.log("[BLE_EVENTS_TRACE]", {
      step: "role_pass",
      profile_role: profile?.role ?? null,
    });
    if (!isUuid(profileStoreUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const gatewayIdFilter = String(url.searchParams.get("gateway_id") ?? "").trim();
    const eventTypeFilterRaw = String(url.searchParams.get("event_type") ?? "")
      .trim()
      .toLowerCase();
    const eventTypeFilter = ALLOWED_EVENT_TYPES.has(eventTypeFilterRaw)
      ? eventTypeFilterRaw
      : "";
    const requestMeta = {
      profile_store_uuid: profileStoreUuid,
      gateway_id: gatewayIdFilter || null,
      event_type: eventTypeFilter || null,
      event_type_raw: eventTypeFilterRaw || null,
      limit,
    };

    console.log("[BLE_EVENTS_TRACE]", {
      step: "before_related_query_1",
      ...requestMeta,
    });
    let gatewayQueryFallback: "none" | "without_is_active" | "zero_rows" = "none";
    let gatewayResult = await supabase
      .from("ble_gateways")
      .select("gateway_id")
      .eq("store_uuid", profileStoreUuid)
      .eq("is_active", true);
    if (gatewayResult.error) {
      logEventsQueryIssue("error", "ble_gateways_lookup", gatewayResult.error, requestMeta);
      if (isMissingColumn(gatewayResult.error, ["is_active"])) {
        gatewayQueryFallback = "without_is_active";
        logEventsQueryIssue("warn", "ble_gateways_without_is_active_fallback", gatewayResult.error, requestMeta);
        gatewayResult = await supabase
          .from("ble_gateways")
          .select("gateway_id")
          .eq("store_uuid", profileStoreUuid);
      } else if (isMissingTableOrSchemaCache(gatewayResult.error, ["public.ble_gateways", "ble_gateways"])) {
        gatewayQueryFallback = "zero_rows";
        logEventsQueryIssue("warn", "ble_gateways_zero_fallback", gatewayResult.error, requestMeta);
        console.log("[BLE_EVENTS_TRACE]", {
          step: "after_related_query_1",
          gateway_count: 0,
          fallback: gatewayQueryFallback,
        });
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_response",
          row_count: 0,
          fallback: gatewayQueryFallback,
        });
        return NextResponse.json({ ok: true, rows: [] }, { status: 200 });
      }
    }
    if (gatewayResult.error) {
      logEventsQueryIssue("error", "ble_gateways_lookup_fallback", gatewayResult.error, requestMeta);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: String(gatewayResult.error.message ?? gatewayResult.error) },
        { status: 500 }
      );
    }
    const gateways = gatewayResult.data;

    const allowedGatewayIds = new Set(
      (Array.isArray(gateways) ? gateways : [])
        .map((row) => String((row as any)?.gateway_id ?? "").trim())
        .filter((gatewayId) => gatewayId !== "")
    );
    console.log("[BLE_EVENTS_TRACE]", {
      step: "after_related_query_1",
      gateway_count: allowedGatewayIds.size,
      fallback: gatewayQueryFallback,
    });

    if (gatewayIdFilter) {
      if (!allowedGatewayIds.has(gatewayIdFilter)) {
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_response",
          row_count: 0,
        });
        return NextResponse.json({ ok: true, rows: [] }, { status: 200 });
      }
    }

    const gatewayIdsForQuery = gatewayIdFilter
      ? [gatewayIdFilter]
      : Array.from(allowedGatewayIds);
    if (gatewayIdsForQuery.length <= 0) {
      console.log("[BLE_EVENTS_TRACE]", {
        step: "before_response",
        row_count: 0,
      });
      return NextResponse.json({ ok: true, rows: [] }, { status: 200 });
    }

    const buildEventsQuery = (mode: "canonical" | "without_hostess_uuid" | "minimal") => {
      const selectClause =
        mode === "canonical"
          ? "id, gateway_id, beacon_minor, event_type, observed_at, room_uuid, meta"
          : mode === "without_hostess_uuid"
            ? "id, gateway_id, beacon_minor, event_type, observed_at, room_uuid, meta"
            : "id, gateway_id, beacon_minor, event_type, observed_at";
      let query = supabase
        .from("ble_ingest_events")
        .select(selectClause)
        .in("gateway_id", gatewayIdsForQuery)
        .order("observed_at", { ascending: false })
        .limit(limit);

      if (eventTypeFilter) {
        query = query.eq("event_type", eventTypeFilter);
      }
      return query;
    };

    console.log("[BLE_EVENTS_TRACE]", {
      step: "before_main_query",
      gateway_count: gatewayIdsForQuery.length,
      ...requestMeta,
    });
    let mainQueryFallback: "none" | "without_hostess_uuid" | "minimal_projection" | "zero_rows" = "none";
    let eventsResult = await buildEventsQuery("canonical");
    if (eventsResult.error) {
      logEventsQueryIssue("error", "ble_ingest_events_canonical_query", eventsResult.error, requestMeta);
      if (isMissingColumn(eventsResult.error, ["hostess_uuid"])) {
        mainQueryFallback = "without_hostess_uuid";
        logEventsQueryIssue("warn", "ble_ingest_events_without_hostess_uuid_fallback", eventsResult.error, requestMeta);
        eventsResult = await buildEventsQuery("without_hostess_uuid");
      } else if (isMissingColumn(eventsResult.error, ["room_uuid", "meta"])) {
        mainQueryFallback = "minimal_projection";
        logEventsQueryIssue("warn", "ble_ingest_events_minimal_projection_fallback", eventsResult.error, requestMeta);
        eventsResult = await buildEventsQuery("minimal");
      } else if (
        isMissingTableOrSchemaCache(eventsResult.error, ["public.ble_ingest_events", "ble_ingest_events"]) ||
        isMissingColumn(eventsResult.error, ["observed_at", "event_type", "beacon_minor", "gateway_id"])
      ) {
        mainQueryFallback = "zero_rows";
        logEventsQueryIssue("warn", "ble_ingest_events_zero_fallback", eventsResult.error, requestMeta);
        console.log("[BLE_EVENTS_TRACE]", {
          step: "after_main_query",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_transform",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_response",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        return NextResponse.json({ ok: true, rows: [] }, { status: 200 });
      }
    }
    if (eventsResult.error && mainQueryFallback === "without_hostess_uuid") {
      logEventsQueryIssue("error", "ble_ingest_events_without_hostess_uuid_query", eventsResult.error, requestMeta);
      if (isMissingColumn(eventsResult.error, ["room_uuid", "meta"])) {
        mainQueryFallback = "minimal_projection";
        logEventsQueryIssue("warn", "ble_ingest_events_minimal_projection_fallback", eventsResult.error, requestMeta);
        eventsResult = await buildEventsQuery("minimal");
      } else if (isMissingTableOrSchemaCache(eventsResult.error, ["public.ble_ingest_events", "ble_ingest_events"])) {
        mainQueryFallback = "zero_rows";
        logEventsQueryIssue("warn", "ble_ingest_events_zero_fallback", eventsResult.error, requestMeta);
        console.log("[BLE_EVENTS_TRACE]", {
          step: "after_main_query",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_transform",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        console.log("[BLE_EVENTS_TRACE]", {
          step: "before_response",
          row_count: 0,
          fallback: mainQueryFallback,
        });
        return NextResponse.json({ ok: true, rows: [] }, { status: 200 });
      }
    }
    if (eventsResult.error) {
      logEventsQueryIssue("error", "ble_ingest_events_query_fallback", eventsResult.error, requestMeta);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: String(eventsResult.error.message ?? eventsResult.error) },
        { status: 500 }
      );
    }
    const data = eventsResult.data;
    console.log("[BLE_EVENTS_TRACE]", {
      step: "after_main_query",
      row_count: Array.isArray(data) ? data.length : 0,
      fallback: mainQueryFallback,
    });

    console.log("[BLE_EVENTS_TRACE]", {
      step: "before_transform",
      row_count: Array.isArray(data) ? data.length : 0,
      fallback: mainQueryFallback,
    });
    const rows = (Array.isArray(data) ? data : []).map((row: any) => {
      const metadata = toMetadataObject(row?.meta ?? row?.metadata);
      const metaHostessId = metadata["hostess_id"];
      return {
        id: String(row?.id ?? "").trim(),
        gateway_id: String(row?.gateway_id ?? "").trim(),
        beacon_minor: Number.isFinite(Number(row?.beacon_minor ?? NaN))
          ? Math.trunc(Number(row?.beacon_minor))
          : 0,
        event_type: String(row?.event_type ?? "").trim().toLowerCase(),
        observed_at: String(row?.observed_at ?? "").trim(),
        received_at: String(row?.observed_at ?? "").trim(),
        room_uuid: isUuid(row?.room_uuid) ? String(row.room_uuid).trim() : null,
        hostess_uuid: isUuid(metaHostessId)
          ? String(metaHostessId).trim()
          : isUuid(row?.hostess_uuid)
            ? String(row.hostess_uuid).trim()
            : null,
        metadata,
      };
    });

    console.log("[BLE_EVENTS_TRACE]", {
      step: "before_response",
      row_count: rows.length,
      fallback: mainQueryFallback,
    });
    return NextResponse.json({ ok: true, rows }, { status: 200 });
  } catch (error) {
    console.log("[BLE_EVENTS_TRACE]", {
      step: "catch",
      message: error instanceof Error ? error.message : String(error),
    });
    console.error("[BLE_EVENTS_EXCEPTION]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

