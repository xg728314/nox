import { createClient } from "@supabase/supabase-js";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GatewayAlivePayload = {
  gateway_id: string;
  status: "alive";
  ip: string;
  uptime_ms: number;
  wifi_rssi: number;
};

type GatewayRow = {
  id: string | null;
  gateway_id: string;
  is_active: boolean | null;
  store_uuid: string | null;
  room_uuid: string | null;
  gateway_secret?: string | null;
};

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function previewSecret(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 6) return `${trimmed}...`;
  return `${trimmed.slice(0, 6)}...`;
}

function parseGatewayAlivePayload(raw: unknown): { ok: true; payload: GatewayAlivePayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "INVALID_BODY" };
  const body = raw as Record<string, unknown>;
  const gatewayId = typeof body.gateway_id === "string" ? body.gateway_id.trim() : "";
  if (!gatewayId) return { ok: false, error: "GATEWAY_ID_REQUIRED" };
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (status !== "alive") return { ok: false, error: "STATUS_INVALID" };
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const uptimeMs = toInt(body.uptime_ms);
  if (!Number.isFinite(uptimeMs) || uptimeMs < 0) return { ok: false, error: "UPTIME_MS_INVALID" };
  const wifiRssi = toInt(body.wifi_rssi);
  if (!Number.isFinite(wifiRssi)) return { ok: false, error: "WIFI_RSSI_INVALID" };
  return {
    ok: true,
    payload: {
      gateway_id: gatewayId,
      status: "alive",
      ip,
      uptime_ms: uptimeMs,
      wifi_rssi: wifiRssi,
    },
  };
}

export async function POST(req: Request) {
  const gatewayKey =
    req.headers.get("x-gateway-key") ||
    req.headers.get("x-gateway-secret") ||
    "";

  if (process.env.NODE_ENV !== "production") {
    console.log("[BLE_ALIVE_HEADERS]", {
      has_x_gateway_key: Boolean(req.headers.get("x-gateway-key")),
      has_x_gateway_secret: Boolean(req.headers.get("x-gateway-secret")),
      gateway_key_preview: previewSecret(gatewayKey),
    });
  }

  if (!gatewayKey || gatewayKey.trim().length <= 0) {
    return NextResponse.json(
      { ok: false, gateway_id: "", error: "GATEWAY_AUTH_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, gateway_id: "", error: "INVALID_JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parsed = parseGatewayAlivePayload(body);

  if (process.env.NODE_ENV !== "production") {
    console.log("[BLE_ALIVE_TRACE]", {
      gateway_id: parsed.ok ? parsed.payload.gateway_id : typeof (body as any)?.gateway_id === "string" ? String((body as any).gateway_id).trim() : "",
      parse_ok: parsed.ok,
      parse_error: parsed.ok ? null : parsed.error,
      has_secret: Boolean(gatewayKey.trim()),
      secret_preview: previewSecret(gatewayKey),
      body_status: typeof (body as any)?.status === "string" ? String((body as any).status) : null,
      body_ip: typeof (body as any)?.ip === "string" ? String((body as any).ip) : null,
      body_uptime_ms: (body as any)?.uptime_ms ?? null,
      body_wifi_rssi: (body as any)?.wifi_rssi ?? null,
    });
  }

  if (!parsed.ok) {
    const gatewayIdHint = typeof (body as any)?.gateway_id === "string" ? String((body as any).gateway_id).trim() : "";
    return NextResponse.json(
      { ok: false, gateway_id: gatewayIdHint, error: parsed.error },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const svcUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!svcUrl || !svcKey) {
    return NextResponse.json(
      { ok: false, gateway_id: parsed.payload.gateway_id, error: "SERVICE_ROLE_UNAVAILABLE" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = createClient(svcUrl, svcKey, {
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

  const trimmedGatewayKey = gatewayKey.trim();

  const { data: authGateway, error: authErr } = await supabase
    .from("ble_gateways")
    .select("id, gateway_id, is_active, store_uuid, room_uuid, gateway_secret")
    .eq("gateway_secret", trimmedGatewayKey)
    .maybeSingle();

  if (process.env.NODE_ENV !== "production") {
    console.log("[BLE_ALIVE_DB]", {
      found: Boolean(authGateway),
      auth_error: authErr ? String(authErr.message ?? authErr) : null,
      payload_gateway_id: parsed.payload.gateway_id,
      matched_gateway_id: authGateway?.gateway_id ?? null,
      is_active: authGateway?.is_active ?? null,
      has_db_secret: Boolean(authGateway?.gateway_secret),
      db_secret_preview: previewSecret(authGateway?.gateway_secret ?? null),
    });
  }

  if (authErr) {
    return NextResponse.json(
      { ok: false, gateway_id: parsed.payload.gateway_id, error: `GATEWAY_AUTH_LOOKUP_FAIL:${String(authErr.message ?? authErr)}` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!authGateway) {
    return NextResponse.json(
      { ok: false, gateway_id: parsed.payload.gateway_id, error: "GATEWAY_AUTH_INVALID" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const gateway = authGateway as GatewayRow;
  const authenticatedGatewayId = String(gateway.gateway_id ?? "").trim();

  if (gateway.is_active === false) {
    return NextResponse.json(
      { ok: false, gateway_id: authenticatedGatewayId, error: "GATEWAY_INACTIVE" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (parsed.payload.gateway_id !== authenticatedGatewayId) {
    return NextResponse.json(
      {
        ok: false,
        gateway_id: authenticatedGatewayId,
        error: `GATEWAY_ID_MISMATCH:payload=${parsed.payload.gateway_id},auth=${authenticatedGatewayId}`,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const ip = parsed.payload.ip && isIP(parsed.payload.ip) ? parsed.payload.ip : null;
  const { error: insertErr } = await supabase.from("ble_gateway_heartbeats").insert({
    gateway_id: authenticatedGatewayId,
    gateway_db_id: isUuid(gateway.id) ? gateway.id.trim() : null,
    store_uuid: isUuid(gateway.store_uuid) ? gateway.store_uuid.trim() : null,
    room_uuid: isUuid(gateway.room_uuid) ? gateway.room_uuid.trim() : null,
    status: "alive",
    ip,
    meta: {
      ip: parsed.payload.ip,
      uptime_ms: parsed.payload.uptime_ms,
      wifi_rssi: parsed.payload.wifi_rssi,
    },
  });

  if (insertErr) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[BLE_ALIVE_INSERT_FAIL]", {
        gateway_id: authenticatedGatewayId,
        error: String(insertErr.message ?? insertErr),
      });
    }

    return NextResponse.json(
      { ok: false, gateway_id: authenticatedGatewayId, error: `GATEWAY_ALIVE_INSERT_FAIL:${String(insertErr.message ?? insertErr)}` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[BLE_GATEWAY_ALIVE]", {
      gateway_id: authenticatedGatewayId,
      ip: parsed.payload.ip || null,
      uptime_ms: parsed.payload.uptime_ms,
      wifi_rssi: parsed.payload.wifi_rssi,
    });
  }

  return NextResponse.json(
    { ok: true, gateway_id: authenticatedGatewayId, status: "alive" },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}