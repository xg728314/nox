import { existsSync, statSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OTA_VERSION = "1.0.1";
const OTA_FILENAME = "foxpro_ble_gateway_1.0.1.bin";

function normalizeVersion(value: string | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function compareVersion(left: string | null, right: string | null): number {
  const leftParts = String(left ?? "")
    .split(".")
    .map((part) => Number(part.trim()))
    .map((part) => (Number.isFinite(part) ? Math.trunc(part) : 0));
  const rightParts = String(right ?? "")
    .split(".")
    .map((part) => Number(part.trim()))
    .map((part) => (Number.isFinite(part) ? Math.trunc(part) : 0));
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < maxLength; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = String(req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() || "";
  const forwardedHost = String(req.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim() || "";
  const hostHeader = String(req.headers.get("host") ?? "").trim();
  const protocol = forwardedProto || url.protocol.replace(/:$/, "") || "http";
  const host = forwardedHost || hostHeader || url.host;
  return `${protocol}://${host}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gatewayId = String(url.searchParams.get("gateway_id") ?? "").trim();
  const currentVersion = normalizeVersion(url.searchParams.get("current_version"));
  const firmwarePath = join(process.cwd(), "public", "firmware", OTA_FILENAME);
  const firmwareExists = existsSync(firmwarePath);
  const firmwareSize = firmwareExists ? statSync(firmwarePath).size : null;
  const origin = resolveRequestOrigin(req);
  const downloadUrl = new URL(`/firmware/${encodeURIComponent(OTA_FILENAME)}`, origin).toString();
  const hasUpdate = currentVersion == null ? true : compareVersion(OTA_VERSION, currentVersion) > 0;

  if (process.env.NODE_ENV !== "production") {
    try {
      console.debug("[BLE_OTA]", {
        gateway_id: gatewayId || null,
        current_version: currentVersion,
        latest_version: OTA_VERSION,
        has_update: hasUpdate,
        firmware_exists: firmwareExists,
        origin,
        download_url: downloadUrl,
      });
    } catch {
      // Ignore logging failures and keep the endpoint quiet.
    }
  }

  return NextResponse.json(
    {
      ok: true,
      gateway_id: gatewayId || null,
      current_version: currentVersion,
      version: OTA_VERSION,
      latest_version: OTA_VERSION,
      has_update: hasUpdate,
      filename: OTA_FILENAME,
      url: downloadUrl,
      download_url: downloadUrl,
      binary_url: downloadUrl,
      firmware_path: `/firmware/${OTA_FILENAME}`,
      file_size_bytes: firmwareSize,
      available: firmwareExists,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
