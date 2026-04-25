import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { assertUuidForOr } from "@/lib/security/postgrestEscape"

/**
 * /api/admin/preferences — admin-forced counter preference overrides.
 *
 * Authoritative layer above `user_preferences`. Runtime precedence:
 *   forced_per_store > forced_global > user_per_store > user_global > DEFAULT
 *
 * GET    ?scope=<scope>
 *   Readable by any authenticated user. Response:
 *     { scope,
 *       global:    RoomLayoutConfig | SidebarMenuConfig | null,
 *       per_store: { [caller_store_uuid]: config }  — only caller's store
 *     }
 *   (Shape matches `/api/me/preferences` so client-side code can reuse
 *   the same slot shape.)
 *
 * PUT    body { scope, store_uuid|null, layout_config }
 *   - store_uuid null → global forced override. Requires super-admin.
 *   - store_uuid set  → store forced override. Requires owner of that
 *     store OR super-admin.
 *   Upsert on the active (scope[, store]) row; stamps updated_by.
 *
 * DELETE body { scope, store_uuid|null }
 *   Soft-delete. Same auth as PUT.
 */

type Row = {
  store_uuid: string | null
  scope: string
  layout_config: unknown
  updated_at: string
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function authErrorResponse(e: AuthError) {
  const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
  return NextResponse.json({ error: e.type, message: e.message }, { status })
}

/**
 * Authorize a write. Returns null if authorized; otherwise a NextResponse.
 *
 *   - store_uuid null (global)    → super-admin only.
 *   - store_uuid set (store-wide) → owner of that store OR super-admin.
 */
function authorizeWrite(
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  store_uuid: string | null,
): NextResponse | null {
  if (store_uuid === null) {
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "전역 강제 override 는 super-admin 만 설정할 수 있습니다." },
        { status: 403 },
      )
    }
    return null
  }
  // store-scoped
  if (auth.is_super_admin) return null
  if (auth.role === "owner" && auth.store_uuid === store_uuid) return null
  return NextResponse.json(
    { error: "FORBIDDEN", message: "이 매장의 강제 override 는 매장 owner 또는 super-admin 만 설정할 수 있습니다." },
    { status: 403 },
  )
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const scope = (url.searchParams.get("scope") ?? "").trim()
    if (!scope) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "scope is required" }, { status: 400 })
    }

    const supabase = supa()
    // Fetch global row + caller's store row in a single call. Cross-store
    // forced overrides for OTHER stores are never returned to non-super-admin
    // callers — even if read, they wouldn't affect the caller's resolution.
    // SECURITY (R-4 defence-in-depth): validate the server-trusted
    // store_uuid is a well-formed UUID before splicing into `.or()`.
    const safeStoreUuid = assertUuidForOr(auth.store_uuid)
    if (safeStoreUuid === null) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Invalid store scope." },
        { status: 500 },
      )
    }
    const { data, error } = await supabase
      .from("admin_preference_overrides")
      .select("store_uuid, scope, layout_config, updated_at")
      .eq("scope", scope)
      .is("deleted_at", null)
      .or(`store_uuid.is.null,store_uuid.eq.${safeStoreUuid}`)
    if (error) {
      console.error("[admin/preferences] failed:", error)
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    const rows = (data ?? []) as Row[]
    let globalCfg: unknown = null
    const perStore: Record<string, unknown> = {}
    for (const r of rows) {
      if (r.store_uuid == null) globalCfg = r.layout_config
      else if (r.store_uuid === auth.store_uuid) perStore[r.store_uuid] = r.layout_config
    }
    return NextResponse.json({ scope, global: globalCfg, per_store: perStore })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = typeof body.scope === "string" ? body.scope.trim() : ""
    const layout_config = body.layout_config
    const rawStore = body.store_uuid
    const store_uuid: string | null =
      rawStore == null || rawStore === ""
        ? null
        : typeof rawStore === "string"
          ? rawStore
          : null

    if (!scope) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "scope is required" }, { status: 400 })
    }
    if (layout_config == null || typeof layout_config !== "object") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "layout_config must be a JSON object" }, { status: 400 })
    }

    const unauth = authorizeWrite(auth, store_uuid)
    if (unauth) return unauth

    const supabase = supa()

    const matchQuery = supabase
      .from("admin_preference_overrides")
      .select("id")
      .eq("scope", scope)
      .is("deleted_at", null)
      .limit(1)
    const existing = store_uuid === null
      ? await matchQuery.is("store_uuid", null)
      : await matchQuery.eq("store_uuid", store_uuid)

    if (existing.error) {
      console.error("[admin/preferences] existing query failed:", existing.error)
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    const now = new Date().toISOString()
    if (existing.data && existing.data.length > 0) {
      const id = existing.data[0].id
      const { error: upErr } = await supabase
        .from("admin_preference_overrides")
        .update({
          layout_config,
          updated_by_user_id: auth.user_id,
          updated_at: now,
        })
        .eq("id", id)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, id })
    } else {
      const { data, error: insErr } = await supabase
        .from("admin_preference_overrides")
        .insert({
          store_uuid,
          scope,
          layout_config,
          created_by_user_id: auth.user_id,
          updated_by_user_id: auth.user_id,
        })
        .select("id")
        .single()
      if (insErr || !data) {
        return NextResponse.json({ error: "INSERT_FAILED", message: insErr?.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
    }
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = typeof body.scope === "string" ? body.scope.trim() : ""
    const rawStore = body.store_uuid
    const store_uuid: string | null =
      rawStore == null || rawStore === ""
        ? null
        : typeof rawStore === "string"
          ? rawStore
          : null

    if (!scope) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "scope is required" }, { status: 400 })
    }
    const unauth = authorizeWrite(auth, store_uuid)
    if (unauth) return unauth

    const supabase = supa()
    const now = new Date().toISOString()
    const base = supabase
      .from("admin_preference_overrides")
      .update({
        deleted_at: now,
        updated_at: now,
        updated_by_user_id: auth.user_id,
      })
      .eq("scope", scope)
      .is("deleted_at", null)
    const { error } = store_uuid === null
      ? await base.is("store_uuid", null)
      : await base.eq("store_uuid", store_uuid)
    if (error) {
      console.error("[admin/preferences] delete failed:", error)
      return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
