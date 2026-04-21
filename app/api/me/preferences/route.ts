import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * /api/me/preferences — user-level layout/menu preferences.
 *
 * Phase C scaffold. Stores per-user JSON blobs scoped by `scope` string.
 * Row identity is (user_id, scope) for global rows or
 * (user_id, store_uuid, scope) for per-store overrides.
 *
 * GET    ?scope=<scope>              → { scope, global, per_store }
 *   `global`    : layout_config of the (user_id, scope, store_uuid=null) row
 *   `per_store` : map of store_uuid → layout_config for the user in that scope
 *
 * PUT    body: { scope, store_uuid|null, layout_config }
 *   upsert on the active (user, scope[, store]) row. Soft-deleted rows are
 *   revived via UPDATE on match.
 *
 * DELETE body: { scope, store_uuid|null }
 *   soft-delete (deleted_at = now()) — next GET falls back to the next layer
 *   (per_store→global→DEFAULT) automatically.
 *
 * 권한 규칙:
 *   - 반드시 resolveAuthContext 사용
 *   - 본인 user_id 만 조회/수정 — 다른 사용자 preferences 는 절대 쓰지 않는다
 *   - store_uuid 가 지정되면 caller 가 해당 store 에 approved membership 를
 *     가지고 있어야 한다 (간단히: auth.store_uuid === store_uuid 로 제한).
 *     Phase C 는 cross-store override 허용하지 않음.
 */

type PrefRow = {
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

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const scope = (url.searchParams.get("scope") ?? "").trim()
    if (!scope) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "scope is required" }, { status: 400 })
    }

    const supabase = supa()
    const { data, error } = await supabase
      .from("user_preferences")
      .select("store_uuid, scope, layout_config, updated_at")
      .eq("user_id", auth.user_id)
      .eq("scope", scope)
      .is("deleted_at", null)
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    const rows = (data ?? []) as PrefRow[]
    let global: unknown = null
    const per_store: Record<string, unknown> = {}
    for (const r of rows) {
      if (r.store_uuid == null) global = r.layout_config
      else per_store[r.store_uuid] = r.layout_config
    }
    return NextResponse.json({ scope, global, per_store })
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
    // Cross-store override 금지 — 본인 현재 매장에 한해서만 per-store 저장.
    if (store_uuid !== null && store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN", message: "store_uuid 범위 밖입니다." }, { status: 403 })
    }

    const supabase = supa()

    // 기존 활성 row 를 찾는다 — 있으면 update, 없으면 insert. Soft-deleted
    // row 는 무시하고 새 row 를 insert 한다 (soft-delete → recreate 케이스).
    const matchQuery = supabase
      .from("user_preferences")
      .select("id")
      .eq("user_id", auth.user_id)
      .eq("scope", scope)
      .is("deleted_at", null)
      .limit(1)
    const existing = store_uuid === null
      ? await matchQuery.is("store_uuid", null)
      : await matchQuery.eq("store_uuid", store_uuid)

    if (existing.error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: existing.error.message }, { status: 500 })
    }

    const now = new Date().toISOString()
    if (existing.data && existing.data.length > 0) {
      const id = existing.data[0].id
      const { error: upErr } = await supabase
        .from("user_preferences")
        .update({ layout_config, updated_at: now })
        .eq("id", id)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, id })
    } else {
      const { data, error: insErr } = await supabase
        .from("user_preferences")
        .insert({
          user_id: auth.user_id,
          store_uuid,
          scope,
          layout_config,
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
    if (store_uuid !== null && store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN", message: "store_uuid 범위 밖입니다." }, { status: 403 })
    }

    const supabase = supa()
    const now = new Date().toISOString()
    const base = supabase
      .from("user_preferences")
      .update({ deleted_at: now, updated_at: now })
      .eq("user_id", auth.user_id)
      .eq("scope", scope)
      .is("deleted_at", null)
    const { error } = store_uuid === null
      ? await base.is("store_uuid", null)
      : await base.eq("store_uuid", store_uuid)
    if (error) {
      return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
