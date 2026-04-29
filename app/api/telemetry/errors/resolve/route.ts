import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/telemetry/errors/resolve
 *
 *   owner 만. 같은 (tag, error_name, error_message) 묶음을 해결됨으로 마킹.
 *
 *   Body 옵션 1 (그룹 dismiss — UI 에서 사용):
 *     { tag, error_name, error_message }
 *     → 매장 범위 내 동일 fingerprint 행 전부 resolved_at = now() 로 set.
 *
 *   Body 옵션 2 (전체 청소 — owner 가 "전부 해결됨" 누를 때):
 *     { all: true }
 *     → 매장 범위 내 모든 unresolved 행을 resolved.
 *
 *   Body 옵션 3 (단일 행):
 *     { id }
 *     → 그 한 행만.
 *
 *   Response: { updated: <count> }
 *
 *   2026-04-28: 시스템 에러 모니터에 active/resolved 구분 추가 (R-system-errors-resolve).
 */
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = (await request.json().catch(() => ({}))) as {
      id?: string
      tag?: string | null
      error_name?: string | null
      error_message?: string | null
      all?: boolean
    }

    const now = new Date().toISOString()
    const baseUpdate = { resolved_at: now, resolved_by: auth.user_id }

    // 매장 범위 — owner 의 store + null(익명) 행 모두 가시 → 둘 다 처리 가능.
    function scoped<T>(q: T): T {
      // PostgREST `.or()` 체이닝.
      return (q as unknown as { or: (s: string) => T }).or(
        `store_uuid.eq.${auth.store_uuid},store_uuid.is.null`,
      )
    }

    if (body.id && typeof body.id === "string") {
      const q = supabase
        .from("system_errors")
        .update(baseUpdate)
        .eq("id", body.id)
        .is("resolved_at", null)
      const { data, error } = await scoped(q).select("id")
      if (error) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
      }
      return NextResponse.json({ updated: (data ?? []).length })
    }

    if (body.all === true) {
      const q = supabase
        .from("system_errors")
        .update(baseUpdate)
        .is("resolved_at", null)
      const { data, error } = await scoped(q).select("id")
      if (error) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
      }
      return NextResponse.json({ updated: (data ?? []).length })
    }

    // 그룹 dismiss — fingerprint 매칭. message 는 길어서 startsWith 으로 비교.
    // 정확히 일치시키려면 동일 string. UI 가 server group 의 sample 을 그대로 보내므로 일치.
    const tag = body.tag ?? null
    const errorName = body.error_name ?? null
    const errorMessage = body.error_message ?? null

    if (tag === null && errorName === null && errorMessage === null) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "id, all, 또는 (tag/error_name/error_message) 중 하나가 필요합니다." },
        { status: 400 },
      )
    }

    let q = supabase
      .from("system_errors")
      .update(baseUpdate)
      .is("resolved_at", null)
    q = tag === null ? q.is("tag", null) : q.eq("tag", tag)
    q = errorName === null ? q.is("error_name", null) : q.eq("error_name", errorName)
    q = errorMessage === null
      ? q.is("error_message", null)
      : q.eq("error_message", errorMessage)
    const { data, error } = await scoped(q).select("id")

    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ updated: (data ?? []).length })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
