import { NextResponse } from "next/server"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * Role + store-scope resolver for BLE analytics routes.
 *
 * Visibility policy:
 *   - owner       → own store only
 *   - manager     → own store only
 *   - super-admin → any store (via `?store_uuid=<uuid>` query) or all
 *                   stores when no query is provided
 *   - hostess / waiter / staff → 403
 *
 * Callers use `storeFilter`:
 *   - a concrete uuid → narrow every SQL `.eq("store_uuid", filter)`
 *   - null            → super-admin all-store view (no scope filter)
 *
 * The caller's `auth.store_uuid` is never trusted from client input;
 * super-admin cross-store targeting is the only path that accepts a
 * client-supplied target_store_uuid, and that path requires
 * `auth.is_super_admin === true`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BleAnalyticsScopeOk = {
  ok: true
  storeFilter: string | null // null = all stores (super-admin only)
  isSuperAdmin: boolean
  isCrossStore: boolean
  role: AuthContext["role"]
}

export type BleAnalyticsScopeErr = {
  ok: false
  error: NextResponse
}

export type BleAnalyticsScope = BleAnalyticsScopeOk | BleAnalyticsScopeErr

export function resolveBleAnalyticsScope(
  auth: AuthContext,
  request: Request,
): BleAnalyticsScope {
  const role = auth.role
  const allowed =
    auth.is_super_admin || role === "owner" || role === "manager"
  if (!allowed) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Analytics requires owner/manager/super-admin." },
        { status: 403 },
      ),
    }
  }

  // Non-super-admin owners / managers are pinned to their own store.
  if (!auth.is_super_admin) {
    return {
      ok: true,
      storeFilter: auth.store_uuid,
      isSuperAdmin: false,
      isCrossStore: false,
      role,
    }
  }

  // Super-admin: optional `store_uuid` query lets them narrow. Null /
  // empty = all stores.
  try {
    const url = new URL(request.url)
    const raw = url.searchParams.get("store_uuid")
    if (raw && raw.trim()) {
      const t = raw.trim()
      if (!UUID_RE.test(t)) {
        return {
          ok: false,
          error: NextResponse.json(
            { error: "BAD_REQUEST", message: "store_uuid must be a valid UUID." },
            { status: 400 },
          ),
        }
      }
      return {
        ok: true,
        storeFilter: t,
        isSuperAdmin: true,
        isCrossStore: t !== auth.store_uuid,
        role,
      }
    }
  } catch { /* fallthrough */ }

  return {
    ok: true,
    storeFilter: null,
    isSuperAdmin: true,
    isCrossStore: true,
    role,
  }
}

/** Parse shared filter params with sane defaults. */
export function readBleAnalyticsFilters(request: Request) {
  const url = new URL(request.url)
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 7 * 24 * 60 * 60 * 1000

  const from = parseIso(url.searchParams.get("from")) ?? new Date(defaultFromMs).toISOString()
  const to = parseIso(url.searchParams.get("to")) ?? new Date(nowMs).toISOString()

  const floorRaw = url.searchParams.get("floor")
  const floor = floorRaw && floorRaw !== "all" ? Number(floorRaw) : null
  const floorValid = floor !== null && Number.isInteger(floor) && floor >= 1 && floor <= 20 ? floor : null

  const gateway_id = stringOrNull(url.searchParams.get("gateway_id"), 120)
  const reason = stringOrNull(url.searchParams.get("reason"), 200)
  const corrected_by = stringOrNull(url.searchParams.get("corrected_by"), 64)
  const zone_from = stringOrNull(url.searchParams.get("zone_from"), 40)
  const zone_to = stringOrNull(url.searchParams.get("zone_to"), 40)

  return {
    from,
    to,
    floor: floorValid,
    gateway_id,
    reason,
    corrected_by,
    zone_from,
    zone_to,
  }
}

function parseIso(v: string | null): string | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
function stringOrNull(v: string | null, maxLen: number): string | null {
  if (!v) return null
  const s = v.trim()
  return s.length > 0 ? s.slice(0, maxLen) : null
}
