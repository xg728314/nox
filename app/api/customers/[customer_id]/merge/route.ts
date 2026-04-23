import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/customers/[customer_id]/merge
 * Merge source customer into target (this customer_id).
 * - All sessions referencing source → re-pointed to target
 * - Source customer soft-deleted
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ customer_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Only owner can merge customers." }, { status: 403 })
    }

    const { customer_id: targetId } = await params

    let body: { source_customer_id?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const sourceId = body.source_customer_id
    if (!sourceId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "source_customer_id is required." }, { status: 400 })
    }

    if (sourceId === targetId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Cannot merge customer into itself." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify both exist in same store
    const { data: target } = await supabase.from("customers").select("id, name").eq("id", targetId).eq("store_uuid", authContext.store_uuid).maybeSingle()
    const { data: source } = await supabase.from("customers").select("id, name, memo").eq("id", sourceId).eq("store_uuid", authContext.store_uuid).maybeSingle()

    if (!target || !source) {
      return NextResponse.json({ error: "NOT_FOUND", message: "One or both customers not found." }, { status: 404 })
    }

    // Re-point sessions from source → target
    const { error: updateErr, count } = await supabase
      .from("room_sessions")
      .update({ customer_id: targetId })
      .eq("customer_id", sourceId)
      .eq("store_uuid", authContext.store_uuid)

    if (updateErr) {
      return NextResponse.json({ error: "MERGE_FAILED", message: "Failed to update sessions." }, { status: 500 })
    }

    // Soft-delete source
    await supabase
      .from("customers")
      .update({
        memo: `[병합됨→${target.name}] ${source.memo || ""}`.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceId)
      .eq("store_uuid", authContext.store_uuid)

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "customers",
      entity_id: targetId,
      action: "customer_merged",
      after: { source_id: sourceId, source_name: source.name, target_id: targetId, sessions_moved: count ?? 0 },
    })

    return NextResponse.json({ merged: true, sessions_moved: count ?? 0, target_id: targetId, source_id: sourceId })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
