import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "./resolveAuthContext"

/**
 * STEP-super-admin: cross-store scope resolution helper.
 *
 * Rules:
 *   - Non-super-admin callers → scope locked to their own `store_uuid`.
 *     Any `target_store_uuid` query param is IGNORED silently (does NOT
 *     widen the scope). This preserves the existing store-scope security
 *     model for all legacy routes.
 *   - super_admin callers → may pass `target_store_uuid=<uuid>` to read
 *     from any store. If omitted, falls back to their own membership's
 *     store_uuid (so super_admin can also act within their home store
 *     exactly like an owner).
 *
 * Every cross-store resolution (super_admin using a target different
 * from their home store) is written to `admin_access_logs` as an
 * audit record. Failures to write audit are swallowed — audit is
 * observability, not a security gate.
 */

export type AdminScopeOk = {
  ok: true
  scopeStoreUuid: string
  isCrossStore: boolean
}

export type AdminScopeErr = {
  ok: false
  error: NextResponse
}

export type AdminScope = AdminScopeOk | AdminScopeErr

/**
 * Resolve the effective store scope for a super-admin-capable endpoint.
 *
 * Call this from routes under `/api/super-admin/...`. For regular
 * store-scoped routes (e.g. /api/owner/*), continue to use `authContext.store_uuid`
 * directly.
 */
export async function resolveAdminScope(params: {
  auth: AuthContext
  supabase: SupabaseClient
  request: Request
  screen: string
  requiredTargetFromPath?: string | null
  actionKind?: "read" | "write"
  actionDetail?: string
  metadata?: Record<string, unknown>
}): Promise<AdminScope> {
  const {
    auth,
    supabase,
    request,
    screen,
    requiredTargetFromPath = null,
    actionKind = "read",
    actionDetail,
    metadata,
  } = params

  // super_admin gate
  if (!auth.is_super_admin) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 }
      ),
    }
  }

  // Resolve target — path param wins over query, query wins over home store.
  let target: string | null = requiredTargetFromPath
  if (!target) {
    try {
      const url = new URL(request.url)
      target = url.searchParams.get("target_store_uuid")
    } catch {
      target = null
    }
  }

  const scopeStoreUuid = target || auth.store_uuid
  const isCrossStore = scopeStoreUuid !== auth.store_uuid

  // UUID shape guard (minimal — prevents obvious junk; DB FK validates).
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(scopeStoreUuid)) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "target_store_uuid must be a valid UUID." },
        { status: 400 }
      ),
    }
  }

  // Confirm the target store actually exists and is not soft-deleted.
  try {
    const { data: storeRow } = await supabase
      .from("stores")
      .select("id")
      .eq("id", scopeStoreUuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!storeRow) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: "STORE_NOT_FOUND", message: "Target store does not exist." },
          { status: 404 }
        ),
      }
    }
  } catch {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "STORE_LOOKUP_FAILED", message: "Failed to verify target store." },
        { status: 500 }
      ),
    }
  }

  // Audit record — only for genuine cross-store reads/writes. Writing inside
  // the caller's home store is indistinguishable from a non-super-admin
  // operation, so we skip logging those to keep the audit signal meaningful.
  if (isCrossStore) {
    try {
      await supabase.from("admin_access_logs").insert({
        actor_user_id: auth.user_id,
        actor_role: "super_admin",
        target_store_uuid: scopeStoreUuid,
        screen,
        action_kind: actionKind,
        action_detail: actionDetail ?? null,
        metadata: metadata ?? null,
      })
    } catch {
      // Best effort — audit failures never block the request.
    }
  }

  return { ok: true, scopeStoreUuid, isCrossStore }
}
