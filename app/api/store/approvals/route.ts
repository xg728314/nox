import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/store/approvals — public signup 승인 대상 목록 (owner/manager)
 *
 * Returns pending memberships in the caller's store **restricted to the
 * roles allowed by public signup**: owner / manager / staff. hostess
 * rows are filtered out at the DB level because hostess is an
 * internal-only creation path; a hostess row landing in `pending`
 * (e.g. legacy data, seed, or an internal-tool bug) should not appear
 * in the approvals queue. DB schema / role enum / existing hostess
 * rows are not touched.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    type MembershipRow = { id: string; profile_id: string; role: string; status: string; created_at: string }
    const { data: pending, error } = await supabase
      .from("store_memberships")
      .select("id, profile_id, role, status, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "pending")
      .neq("role", "hostess")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    // STEP-025C: applicant identification — operators need full_name +
    // nickname + phone to act on signup-originated pending requests.
    const profileIds = [...new Set((pending ?? []).map((m: MembershipRow) => m.profile_id))]
    type ProfileLite = { full_name: string | null; nickname: string | null; phone: string | null }
    const profileMap = new Map<string, ProfileLite>()
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, nickname, phone")
        .in("id", profileIds)
      for (const p of profiles ?? []) {
        profileMap.set(p.id, { full_name: p.full_name, nickname: p.nickname, phone: p.phone })
      }
    }

    // STEP-025D: include store_name so operators can confirm scope.
    const { data: storeRow } = await supabase
      .from("stores")
      .select("store_name")
      .eq("id", authContext.store_uuid)
      .maybeSingle()
    const storeName = (storeRow?.store_name as string | undefined) ?? null

    const enriched = (pending ?? []).map((m: MembershipRow) => {
      const p = profileMap.get(m.profile_id)
      return {
        membership_id: m.id,
        profile_id: m.profile_id,
        name: p?.full_name || m.profile_id.slice(0, 8),
        nickname: p?.nickname ?? null,
        phone: p?.phone ?? null,
        role: m.role,
        status: m.status,
        created_at: m.created_at,
      }
    })

    return NextResponse.json({ store_uuid: authContext.store_uuid, store_name: storeName, pending: enriched })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/**
 * POST /api/store/approvals — 승인/거부
 * body: { membership_id, action: "approve"|"reject" }
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: { membership_id?: string; action?: string }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const { membership_id, action } = body
    if (!membership_id || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id and action (approve|reject) required." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify membership exists and is pending
    const { data: membership } = await supabase
      .from("store_memberships")
      .select("id, status")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "pending")
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Pending membership not found." }, { status: 404 })
    }

    const newStatus = action === "approve" ? "approved" : "rejected"
    const { error: updateError } = await supabase
      .from("store_memberships")
      .update({
        status: newStatus,
        approved_by: action === "approve" ? authContext.user_id : null,
        approved_at: action === "approve" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membership_id)

    if (updateError) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "store_memberships",
      entity_id: membership_id,
      action: action === "approve" ? "membership_approved" : "membership_rejected",
      after: { membership_id, status: newStatus },
    })

    return NextResponse.json({ membership_id, status: newStatus })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
