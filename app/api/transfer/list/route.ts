import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { assertUuidForOr } from "@/lib/security/postgrestEscape"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view transfer list." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get("status") // pending, approved, cancelled
    const direction = url.searchParams.get("direction")  // from, to, all (default: all)

    // Build query: show transfers where caller's store is from_store or to_store
    let query = supabase
      .from("transfer_requests")
      .select("id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, reason, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (direction === "from") {
      query = query.eq("from_store_uuid", authContext.store_uuid)
    } else if (direction === "to") {
      query = query.eq("to_store_uuid", authContext.store_uuid)
    } else {
      // SECURITY (R-4 defence-in-depth): authContext.store_uuid is
      // server-trusted (comes from resolveAuthContext which reads it
      // from `store_memberships`), but we still validate it is a
      // well-formed UUID before splicing into the `.or()` expression.
      // If somehow a bad value reaches here, fail-closed with 500 —
      // nobody should see this, and it would indicate a severe bug.
      const safeStoreUuid = assertUuidForOr(authContext.store_uuid)
      if (safeStoreUuid === null) {
        return NextResponse.json(
          { error: "INTERNAL_ERROR", message: "Invalid store scope." },
          { status: 500 },
        )
      }
      query = query.or(
        `from_store_uuid.eq.${safeStoreUuid},to_store_uuid.eq.${safeStoreUuid}`,
      )
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter)
    }

    const { data: transfers, error: fetchError } = await query

    if (fetchError) {
      return NextResponse.json(
        { error: "FETCH_FAILED", message: "Failed to fetch transfer requests." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      count: (transfers ?? []).length,
      transfers: transfers ?? [],
    })

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
