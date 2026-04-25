import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { BUILDING_FLOORS, floorScopeRegex } from "@/lib/building/floors"

/**
 * Scope resolution — single decision point for (scope, auth) → storeUuids[].
 *
 * Phase 3: never fans out to /api/counter/monitor. The caller uses the
 * resolved storeUuids[] with a single IN-based query layer downstream.
 *
 * Access rules (mirrors design §7):
 *   mine           : any role, own store only
 *   current_floor  : non-super → own store only; super → all stores on caller's floor
 *   floor-N        : non-super → forbidden if N ≠ caller's floor; super → all stores on floor N
 *   store-<uuid>   : non-super → forbidden if uuid ≠ caller's store_uuid; super → any
 */

// 2026-04-24: `floor-N` 리터럴 유니온을 BUILDING_FLOORS 에서 파생.
//   건물 층 변경 시 `lib/building/floors.ts` 한 곳만 수정하면 이 타입이
//   자동으로 따라간다.
type FloorScope = `floor-${typeof BUILDING_FLOORS[number]}`

export type Scope =
  | "mine"
  | "current_floor"
  | FloorScope
  | `store-${string}`

export type ScopeResolutionOk = {
  ok: true
  scope: Scope
  storeUuids: string[]
  floor: number | null
  isSuper: boolean
  isCrossStore: boolean
}

export type ScopeResolutionErr = {
  ok: false
  forbidden: NextResponse
}

export type ScopeResolution = ScopeResolutionOk | ScopeResolutionErr

// 2026-04-24: 정규식을 BUILDING_FLOORS 에서 동적 생성.
const FLOOR_SCOPE_RE = floorScopeRegex()
const STORE_SCOPE_RE = /^store-[0-9a-f-]{36}$/i

/** Parse a raw query-param string. Returns null if malformed. */
export function parseScope(raw: string | null | undefined): Scope | null {
  if (!raw) return null
  if (raw === "mine" || raw === "current_floor") return raw
  if (FLOOR_SCOPE_RE.test(raw)) return raw as Scope
  if (STORE_SCOPE_RE.test(raw)) return raw as Scope
  return null
}

function forbidden(message: string): ScopeResolutionErr {
  return {
    ok: false,
    forbidden: NextResponse.json(
      { error: "SCOPE_FORBIDDEN", message },
      { status: 403 },
    ),
  }
}

/** Derive caller's store floor by mode of room.floor_no. */
async function deriveCallerFloor(
  supabase: SupabaseClient,
  storeUuid: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("rooms")
    .select("floor_no")
    .eq("store_uuid", storeUuid)
    .is("deleted_at", null)
  const counts = new Map<number, number>()
  for (const r of (data ?? []) as Array<{ floor_no: number | null }>) {
    if (r.floor_no != null) counts.set(r.floor_no, (counts.get(r.floor_no) ?? 0) + 1)
  }
  let best: number | null = null, max = 0
  for (const [k, v] of counts) if (v > max) { max = v; best = k }
  return best
}

export async function resolveMonitorScope(args: {
  scope: Scope
  auth: AuthContext
  supabase: SupabaseClient
}): Promise<ScopeResolution> {
  const { scope, auth, supabase } = args
  const isSuper = auth.is_super_admin

  // ── mine ─────────────────────────────────────────────────────────
  if (scope === "mine") {
    return {
      ok: true, scope,
      storeUuids: [auth.store_uuid],
      floor: null,
      isSuper,
      isCrossStore: false,
    }
  }

  // ── store-<uuid> ─────────────────────────────────────────────────
  if (scope.startsWith("store-")) {
    const target = scope.slice("store-".length)
    if (!isSuper && target !== auth.store_uuid) {
      return forbidden("cross-store scope requires super_admin.")
    }
    return {
      ok: true, scope,
      storeUuids: [target],
      floor: null,
      isSuper,
      isCrossStore: target !== auth.store_uuid,
    }
  }

  // ── current_floor / floor-N (both floor-based) ──────────────────
  let targetFloor: number | null
  if (scope === "current_floor") {
    targetFloor = await deriveCallerFloor(supabase, auth.store_uuid)
    if (targetFloor == null) {
      // No rooms with floor_no → fall back to single-store scope.
      return {
        ok: true, scope,
        storeUuids: [auth.store_uuid],
        floor: null,
        isSuper,
        isCrossStore: false,
      }
    }
  } else {
    const m = FLOOR_SCOPE_RE.exec(scope)
    if (!m) return forbidden("invalid scope.")
    targetFloor = Number(m[1])
  }

  if (!isSuper) {
    // Non-super can view own store only, and only if own store has rooms
    // on the requested floor.
    const callerFloor = await deriveCallerFloor(supabase, auth.store_uuid)
    if (callerFloor !== targetFloor) {
      return forbidden("only super_admin can view other floors.")
    }
    return {
      ok: true, scope,
      storeUuids: [auth.store_uuid],
      floor: targetFloor,
      isSuper,
      isCrossStore: false,
    }
  }

  // super_admin: all stores with at least one room on targetFloor.
  const { data: roomRows } = await supabase
    .from("rooms")
    .select("store_uuid")
    .eq("floor_no", targetFloor)
    .is("deleted_at", null)
  const storeUuids = Array.from(new Set(
    (roomRows ?? []).map((r: { store_uuid: string }) => r.store_uuid),
  ))

  return {
    ok: true, scope,
    storeUuids,
    floor: targetFloor,
    isSuper,
    isCrossStore: storeUuids.length > 1 || (storeUuids.length === 1 && storeUuids[0] !== auth.store_uuid),
  }
}
