import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import { loadBleDeviceRegistrySnapshot } from "@/lib/ops/ble/deviceRegistryServer";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
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
      route: "/api/ops/ble/devices/unknown",
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

    return NextResponse.json({ ok: true, rows: snapshot.unknownRows }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}
