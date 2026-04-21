import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-NEXT-API — GET /api/owner/accounts/[membership_id]/audit
 *
 * Owner-only audit history for a single membership. Returns audit_events
 * rows where entity_table='store_memberships' AND entity_id=membership_id.
 *
 * Strict rules:
 *   - role gate BEFORE DB
 *   - target membership must be in the same store
 *   - audit query is store_uuid scoped (defense in depth)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { membership_id } = await params
    if (!membership_id || !isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify target belongs to same store BEFORE returning audit rows
    const { data: target } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const { data: events, error } = await supabase
      .from("audit_events")
      .select("id, store_uuid, actor_profile_id, actor_membership_id, actor_role, action, before, after, reason, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("entity_table", "store_memberships")
      .eq("entity_id", membership_id)
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    return NextResponse.json({
      membership_id,
      events: events ?? [],
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
