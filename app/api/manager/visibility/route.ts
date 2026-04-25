import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getManagerVisibility } from "@/lib/server/queries/manager/visibility"

/**
 * GET  /api/manager/visibility — get current visibility settings
 * PATCH /api/manager/visibility — toggle visibility settings
 *
 * Only manager role can access.
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    try {
      const data = await getManagerVisibility(authContext)
      return NextResponse.json(data)
    } catch {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(error.type) ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: { show_profit_to_owner?: boolean; show_hostess_profit_to_owner?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const updatePayload: Record<string, boolean | string> = {
      updated_at: new Date().toISOString(),
    }
    if (body.show_profit_to_owner !== undefined) {
      updatePayload.show_profit_to_owner = body.show_profit_to_owner
    }
    if (body.show_hostess_profit_to_owner !== undefined) {
      updatePayload.show_hostess_profit_to_owner = body.show_hostess_profit_to_owner
    }

    const { data: updated, error: updateErr } = await supabase
      .from("managers")
      .update(updatePayload)
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("membership_id, show_profit_to_owner, show_hostess_profit_to_owner")
      .single()

    if (updateErr || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "managers",
      entity_id: authContext.membership_id,
      action: "manager_visibility_updated",
      after: updatePayload,
    })

    return NextResponse.json({
      show_profit_to_owner: updated.show_profit_to_owner,
      show_hostess_profit_to_owner: updated.show_hostess_profit_to_owner,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(error.type) ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
