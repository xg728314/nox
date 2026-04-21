import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabaseOrError } from "@/lib/supabaseServer";
import { opsLog } from "@/lib/ops/logger";
import { emitAutomationAlert } from "@/lib/automation/alertHooks";
import { writeBleAlertEvent } from "@/lib/ble/logging/writeBleAlertEvent";

export const dynamic = "force-dynamic";

const STALE_PRESENCE_THRESHOLD_HOURS = 4;

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
    .select("store_uuid")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const profileStoreUuid = String((profile as any)?.store_uuid ?? "").trim();
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
    userId: userData.user.id,
  };
}

export async function GET(req: Request) {
  const auth = await requireUserStoreScope();
  if (!auth.ok) return auth.response;
  const { supabase, profileStoreUuid } = auth;

  const cutoffIso = new Date(Date.now() - STALE_PRESENCE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  const { data: staleRows, error: staleErr } = await supabase
    .from("hostess_presence")
    .select("id, hostess_uuid, gateway_id, room_uuid, entered_at, last_seen_at")
    .eq("store_uuid", profileStoreUuid)
    .is("left_at", null)
    .eq("presence_status", "present")
    .lt("last_seen_at", cutoffIso)
    .order("last_seen_at", { ascending: true })
    .limit(100);

  if (staleErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: String(staleErr.message ?? staleErr) },
      { status: 500 }
    );
  }

  const rows = Array.isArray(staleRows) ? staleRows : [];
  return NextResponse.json({
    ok: true,
    stale_count: rows.length,
    threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
    rows: rows.map((row: any) => ({
      id: String(row.id ?? ""),
      hostess_uuid: String(row.hostess_uuid ?? ""),
      gateway_id: String(row.gateway_id ?? ""),
      room_uuid: String(row.room_uuid ?? ""),
      entered_at: String(row.entered_at ?? ""),
      last_seen_at: String(row.last_seen_at ?? ""),
      stale_hours: Math.max(
        0,
        Math.floor((Date.now() - Date.parse(String(row.last_seen_at ?? ""))) / (60 * 60 * 1000))
      ),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireUserStoreScope();
  if (!auth.ok) return auth.response;
  const { supabase, profileStoreUuid, userId } = auth;

  const body = (await req.json().catch(() => null)) as { dry_run?: boolean } | null;
  const dryRun = body?.dry_run === true;

  const cutoffIso = new Date(Date.now() - STALE_PRESENCE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  const { data: staleRows, error: staleErr } = await supabase
    .from("hostess_presence")
    .select("id, hostess_uuid, gateway_id, room_uuid, last_seen_at")
    .eq("store_uuid", profileStoreUuid)
    .is("left_at", null)
    .eq("presence_status", "present")
    .lt("last_seen_at", cutoffIso)
    .limit(500);

  if (staleErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: String(staleErr.message ?? staleErr) },
      { status: 500 }
    );
  }

  const rows = Array.isArray(staleRows) ? staleRows : [];
  if (rows.length <= 0) {
    return NextResponse.json({
      ok: true,
      cleaned: 0,
      threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
      dry_run: dryRun,
      message: "No stale presence rows found",
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      cleaned: 0,
      threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
      dry_run: true,
      message: `Would clean ${rows.length} stale presence rows (dry run)`,
      preview: rows.slice(0, 10).map((row: any) => ({
        hostess_uuid: String(row.hostess_uuid ?? ""),
        gateway_id: String(row.gateway_id ?? ""),
        room_uuid: String(row.room_uuid ?? ""),
        last_seen_at: String(row.last_seen_at ?? ""),
      })),
    });
  }

  if (rows.length <= 0) {
    return NextResponse.json({
      ok: true,
      cleaned: 0,
      threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
      dry_run: false,
      message: "No stale presence rows found",
    });
  }

  let cleanedCount = 0;
  const cleanedGateways = new Set<string>();
  const cleanedRooms = new Map<string, number>();

  for (const row of rows) {
    const rowId = String(row?.id ?? "").trim();
    if (!isUuid(rowId)) continue;
    const lastSeenAt = String(row?.last_seen_at ?? "").trim();
    if (!lastSeenAt) continue;

    const { error: updateErr } = await supabase
      .from("hostess_presence")
      .update({
        left_at: lastSeenAt,
        presence_status: "left",
      })
      .eq("id", rowId)
      .eq("store_uuid", profileStoreUuid)
      .is("left_at", null);

    if (updateErr) {
      opsLog.warn("BLE_PRESENCE_CLEANUP_ROW_FAILED", {
        route: "/api/ops/ble/presence-cleanup",
        user_id: userId,
        detail: { row_id: rowId, error: String(updateErr.message ?? updateErr) },
      });
      continue;
    }

    cleanedCount += 1;
    const gatewayId = String(row?.gateway_id ?? "").trim();
    if (gatewayId) cleanedGateways.add(gatewayId);
    
    // S-BLE-18B: Track cleaned rooms for alert event logging
    const roomUuid = String(row?.room_uuid ?? "").trim();
    if (roomUuid) {
      cleanedRooms.set(roomUuid, (cleanedRooms.get(roomUuid) ?? 0) + 1);
    }
  }
  if (cleanedCount > 0) {
    opsLog.info("BLE_PRESENCE_CLEANUP_OK", {
      route: "/api/ops/ble/presence-cleanup",
      user_id: userId,
      detail: {
        cleaned_count: cleanedCount,
        attempted_count: rows.length,
        threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
        gateways: Array.from(cleanedGateways).slice(0, 10),
      },
    });
    if (cleanedCount >= 10) {
      void emitAutomationAlert(
        {
          type: "BLE_SECURITY_CLEANUP_FAILED",
          message: `BLE presence cleanup: ${cleanedCount} stale rows found (threshold: ${STALE_PRESENCE_THRESHOLD_HOURS}h)`,
          detail: {
            cleaned_count: cleanedCount,
            store_uuid: profileStoreUuid,
            gateways: Array.from(cleanedGateways).slice(0, 5),
          },
        },
        undefined,
        supabase
      );
      
      // S-BLE-18B: Log alert events per room for pattern detection
      // Note: emitAutomationAlert above handles webhook delivery; here we log granular room-level events
      for (const [roomUuid, count] of Array.from(cleanedRooms.entries())) {
        if (count >= 1) {
          void writeBleAlertEvent(supabase, {
            alert_type: "BLE_SECURITY_CLEANUP_FAILED",
            entity_type: "room_id",
            entity_value: roomUuid,
            delivery_status: "sent",
            detail: {
              cleaned_count: count,
              store_uuid: profileStoreUuid,
              threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
            },
          });
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    cleaned: cleanedCount,
    threshold_hours: STALE_PRESENCE_THRESHOLD_HOURS,
    dry_run: false,
    message: `Cleaned ${cleanedCount} of ${rows.length} stale presence rows`,
  });
}

