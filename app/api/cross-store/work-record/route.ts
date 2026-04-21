import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess cannot create cross-store work records." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{ session_id?: string; hostess_membership_id?: string; origin_store_uuid?: string }>(request)
    if (parsed.error) return parsed.error
    const { session_id, hostess_membership_id, origin_store_uuid } = parsed.body

    if (!session_id || !hostess_membership_id || !origin_store_uuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id, hostess_membership_id, origin_store_uuid are required." },
        { status: 400 }
      )
    }

    const workingStoreUuid = authContext.store_uuid

    if (workingStoreUuid === origin_store_uuid) {
      return NextResponse.json(
        { error: "SAME_STORE", message: "Origin store and working store cannot be the same. Use regular participant flow." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. Verify session exists and belongs to working store
    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, business_day_id, status")
      .eq("id", session_id)
      .eq("store_uuid", workingStoreUuid)
      .maybeSingle()

    if (sessionError || !session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND", message: "Session not found in this store." }, { status: 404 })
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "SESSION_NOT_ACTIVE", message: "Session must be active. Current status: " + session.status }, { status: 400 })
    }
    if (!session.business_day_id) {
      return NextResponse.json({ error: "NO_BUSINESS_DAY", message: "Session has no business_day_id." }, { status: 400 })
    }

    // 2. Verify origin store exists
    const { data: originStore } = await supabase
      .from("stores")
      .select("id")
      .eq("id", origin_store_uuid)
      .eq("is_active", true)
      .maybeSingle()

    if (!originStore) {
      return NextResponse.json({ error: "ORIGIN_STORE_NOT_FOUND", message: "Origin store not found or inactive." }, { status: 404 })
    }

    // 3. Verify hostess membership belongs to origin store
    const { data: membership } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("id", hostess_membership_id)
      .eq("store_uuid", origin_store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")
      .is("deleted_at", null)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "HOSTESS_NOT_FOUND", message: "Hostess membership not found in origin store, or not approved." }, { status: 404 })
    }

    // 4. Check duplicate
    const { data: existing } = await supabase
      .from("cross_store_work_records")
      .select("id, status")
      .eq("session_id", session_id)
      .eq("hostess_membership_id", hostess_membership_id)
      .is("deleted_at", null)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: "DUPLICATE_RECORD", message: "Cross-store work record already exists for this session and hostess.", existing_id: existing.id, existing_status: existing.status },
        { status: 409 }
      )
    }

    // 5. INSERT
    const { data: record, error: insertError } = await supabase
      .from("cross_store_work_records")
      .insert({
        session_id,
        business_day_id: session.business_day_id,
        working_store_uuid: workingStoreUuid,
        origin_store_uuid,
        hostess_membership_id,
        requested_by: authContext.user_id,
        status: "pending",
      })
      .select("id, status, created_at")
      .single()

    if (insertError || !record) {
      return NextResponse.json({ error: "CREATE_FAILED", message: insertError?.message || "Failed to create cross-store work record." }, { status: 500 })
    }

    // 6. Audit
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "cross_store_work_records",
      entity_id: record.id,
      action: "cross_store_work_created",
      after: {
        record_id: record.id,
        working_store_uuid: workingStoreUuid,
        origin_store_uuid,
        hostess_membership_id,
        status: "pending",
      },
    })

    return NextResponse.json(
      {
        record_id: record.id,
        session_id,
        working_store_uuid: workingStoreUuid,
        origin_store_uuid,
        hostess_membership_id,
        status: record.status,
        created_at: record.created_at,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "cross-store/work-record")
  }
}
