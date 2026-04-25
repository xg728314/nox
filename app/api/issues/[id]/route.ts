import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * PATCH /api/issues/[id] — 상태 변경 (in_review / resolved / dismissed / duplicate)
 *   owner 만.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "상태 변경 권한이 없습니다." },
        { status: 403 },
      )
    }

    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: string
      resolution_note?: string
    }
    const VALID = ["open", "in_review", "resolved", "dismissed", "duplicate"] as const
    if (!body.status || !VALID.includes(body.status as typeof VALID[number])) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "유효한 status 필요." },
        { status: 400 },
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const updateData: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    }
    if (body.resolution_note !== undefined) {
      updateData.resolution_note = body.resolution_note?.slice(0, 2000) || null
    }
    if (body.status === "resolved" || body.status === "dismissed" || body.status === "duplicate") {
      updateData.resolved_at = new Date().toISOString()
      updateData.resolved_by = auth.user_id
    }

    const { data: updated, error } = await supabase
      .from("issue_reports")
      .update(updateData)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .select("id, status, resolved_at, resolved_by, resolution_note, updated_at")
      .single()

    if (error || !updated) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: error?.message || "수정 실패" },
        { status: 500 },
      )
    }

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
