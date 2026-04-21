import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import { clearBleDeviceRegistryCache } from "@/lib/ops/ble/deviceRegistryServer";

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

export async function POST(req: Request) {
  try {
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/devices/release",
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
        }
      | null;

    const deviceId = normalizeText(body?.device_id) ?? "";
    if (!isUuid(deviceId)) {
      return NextResponse.json({ ok: false, error: "DEVICE_ID_REQUIRED" }, { status: 400 });
    }

    const deviceResult = await supabase
      .from("ble_devices")
      .select("id, store_uuid")
      .eq("store_uuid", storeUuid)
      .eq("id", deviceId)
      .maybeSingle();

    if (deviceResult.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(deviceResult.error) },
        { status: 500 }
      );
    }
    if (!deviceResult.data) {
      return NextResponse.json({ ok: false, error: "DEVICE_NOT_FOUND" }, { status: 404 });
    }

    const releasedAt = new Date().toISOString();
    const updateResult = await supabase
      .from("ble_device_assignments")
      .update({ released_at: releasedAt })
      .eq("device_id", deviceId)
      .is("released_at", null)
      .select("id");

    if (updateResult.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(updateResult.error) },
        { status: 500 }
      );
    }

    clearBleDeviceRegistryCache(storeUuid);
    return NextResponse.json(
      { ok: true, released_count: Array.isArray(updateResult.data) ? updateResult.data.length : 0 },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}
