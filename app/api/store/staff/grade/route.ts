import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

const VALID_GRADES = ["S", "A", "B", "C"] as const

/**
 * PATCH /api/store/staff/grade
 * Body: { membership_id: string, grade: 'S'|'A'|'B'|'C'|null }
 * Only owner/manager can set grades.
 */
export async function PATCH(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: { membership_id?: string; grade?: string | null }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 })
    }

    const { membership_id, grade } = body
    if (!membership_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id is required." }, { status: 400 })
    }

    // Validate grade value
    if (grade !== null && grade !== undefined && !VALID_GRADES.includes(grade as typeof VALID_GRADES[number])) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "grade must be S, A, B, C, or null." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify hostess belongs to this store
    const { data: hostess, error: findErr } = await supabase
      .from("hostesses")
      .select("id, membership_id, grade, store_uuid")
      .eq("membership_id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (findErr || !hostess) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Hostess not found in this store." }, { status: 404 })
    }

    const now = new Date().toISOString()
    const gradeValue = grade ?? null

    const { data: updated, error: updateErr } = await supabase
      .from("hostesses")
      .update({
        grade: gradeValue,
        grade_updated_at: now,
        grade_updated_by: authContext.user_id,
        updated_at: now,
      })
      .eq("id", hostess.id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .select("membership_id, grade, grade_updated_at")
      .single()

    if (updateErr || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: "Failed to update grade." }, { status: 500 })
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "hostesses",
      entity_id: hostess.id,
      action: "hostess_grade_updated",
      before: { grade: hostess.grade },
      after: { grade: gradeValue },
    })

    return NextResponse.json({
      membership_id: updated.membership_id,
      grade: updated.grade,
      grade_updated_at: updated.grade_updated_at,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(error.type) ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
