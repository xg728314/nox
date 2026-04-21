import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabaseOrError } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

async function requireUserStoreScope() {
  const cookieStore = await cookies();
  const sbResult = getServerSupabaseOrError(cookieStore);
  if (!sbResult.ok) return { ok: false as const, response: sbResult.error };
  const supabase = sbResult.supabase;

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("store_uuid, role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const profileStoreUuid = String((profile as any)?.store_uuid ?? "").trim();
  const profileRole = String((profile as any)?.role ?? "").trim();

  if (profileErr || !isUuid(profileStoreUuid)) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    supabase,
    profileStoreUuid,
    profileRole,
    userId: userData.user.id,
  };
}

export async function GET(req: Request) {
  const auth = await requireUserStoreScope();
  if (!auth.ok) return auth.response;
  const { supabase, profileStoreUuid, profileRole } = auth;

  const url = new URL(req.url);
  const code = String(url.searchParams.get("code") ?? "").trim();
  const gatewayId = String(url.searchParams.get("gateway_id") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Math.max(1, Math.min(500, Math.trunc(limitRaw)));

  // Query ble_security_alert_events table
  let query = supabase
    .from("ble_security_alert_events")
    .select("id, created_at, code, severity, message, ip, gateway_id, store_uuid, room_uuid, meta")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (profileRole !== "admin") {
    query = query.eq("store_uuid", profileStoreUuid);
  }

  if (code) {
    query = query.eq("code", code);
  }
  if (gatewayId) {
    query = query.eq("gateway_id", gatewayId);
  }

  const { data: rows, error: queryErr } = await query;
  if (queryErr) {
    console.error("[security-events] Query error:", {
      table: "ble_security_alert_events",
      message: queryErr.message,
      details: queryErr.details,
      hint: queryErr.hint,
      code: queryErr.code,
    });
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: String(queryErr.message ?? queryErr) },
      { status: 500 }
    );
  }

  // Normalize rows to match page expectations
  const normalizedRows = Array.isArray(rows) ? rows.map((row: any) => ({
    id: row.id,
    occurred_at: row.created_at,
    code: row.code,
    route: "/api/ble/ingest",
    gateway_id: row.gateway_id,
    store_uuid: row.store_uuid,
    ip: row.ip,
    user_agent: null,
    detail: row.meta || null,
  })) : [];

  const { data: statsRows, error: statsErr } = await supabase
    .from("ble_security_alert_events")
    .select("alert_type")
    .gte("occurred_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const codeStats = new Map<string, number>();
  if (!statsErr && Array.isArray(statsRows)) {
    for (const row of statsRows) {
      const code = String((row as any)?.alert_type ?? "").trim();
      if (!code) continue;
      codeStats.set(code, (codeStats.get(code) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    ok: true,
    rows: normalizedRows,
    stats_24h: Object.fromEntries(codeStats),
  });
}