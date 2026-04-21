import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import { clearBleDeviceRegistryCache, loadBleDeviceRegistrySnapshot } from "@/lib/ops/ble/deviceRegistryServer";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function formatAnyError(error: unknown): string {
  if (error instanceof Error) return String(error.message ?? "").trim() || "UNKNOWN_ERROR";
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    return [obj.code, obj.message, obj.details, obj.hint]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(" ") || "UNKNOWN_ERROR";
  }
  return typeof error === "string" ? error.trim() || "UNKNOWN_ERROR" : "UNKNOWN_ERROR";
}

export async function GET(req: Request) {
  try {
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/devices",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;

    const { supabase, profile } = ctx;
    const storeUuid = typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    if (!isUuid(storeUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const snapshot = await loadBleDeviceRegistrySnapshot({
      supabase,
      storeUuid,
    });

    return NextResponse.json(
      {
        ok: true,
        rows: snapshot.rows,
        people: snapshot.people,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/devices",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;

    const { supabase, profile } = ctx;
    const storeUuid = typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    if (!isUuid(storeUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          device_uid?: unknown;
          label?: unknown;
        }
      | null;

    const deviceUid = normalizeText(body?.device_uid) ?? "";
    const label = normalizeText(body?.label);
    if (!deviceUid) {
      return NextResponse.json({ ok: false, error: "DEVICE_UID_REQUIRED" }, { status: 400 });
    }

    const insertResult = await supabase
      .from("ble_devices")
      .insert({
        store_uuid: storeUuid,
        device_uid: deviceUid,
        device_type: "beacon_tag",
        label,
        is_active: true,
      })
      .select("id, store_uuid, device_uid, device_type, label, is_active, created_at, updated_at")
      .maybeSingle();

    if (insertResult.error) {
      const code = String((insertResult.error as any)?.code ?? "").trim();
      if (code === "23505") {
        return NextResponse.json({ ok: false, error: "DEVICE_UID_DUPLICATED" }, { status: 409 });
      }
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(insertResult.error) },
        { status: 500 }
      );
    }

    clearBleDeviceRegistryCache(storeUuid);
    return NextResponse.json({ ok: true, row: insertResult.data ?? null }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/devices",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;

    const { supabase, profile } = ctx;
    const storeUuid = typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    if (!isUuid(storeUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          device_id?: unknown;
          label?: unknown;
          is_active?: unknown;
        }
      | null;

    const deviceId = normalizeText(body?.device_id) ?? "";
    if (!isUuid(deviceId)) {
      return NextResponse.json({ ok: false, error: "DEVICE_ID_REQUIRED" }, { status: 400 });
    }

    const label = normalizeText(body?.label);
    const hasIsActive = typeof body?.is_active === "boolean";
    const updates: Record<string, unknown> = {
      label,
    };
    if (hasIsActive) {
      updates.is_active = body?.is_active === true;
    }

    const updateResult = await supabase
      .from("ble_devices")
      .update(updates)
      .eq("store_uuid", storeUuid)
      .eq("id", deviceId)
      .select("id, store_uuid, device_uid, device_type, label, is_active, created_at, updated_at")
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(updateResult.error) },
        { status: 500 }
      );
    }
    if (!updateResult.data) {
      return NextResponse.json({ ok: false, error: "DEVICE_NOT_FOUND" }, { status: 404 });
    }

    clearBleDeviceRegistryCache(storeUuid);
    return NextResponse.json({ ok: true, row: updateResult.data }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}
