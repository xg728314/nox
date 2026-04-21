import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> }
) {
  try {
    const { hostess_id: hostessIdParam } = await params
    const authContext = await resolveAuthContext(request)

    // Role gate: manager only
    if (authContext.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "This endpoint is restricted to manager role." },
        { status: 403 }
      )
    }

    const hostessId = hostessIdParam
    if (!hostessId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify assignment: manager must be assigned to this hostess
    const { data: assignment, error: assignmentError } = await supabase
      .from("hostesses")
      .select("hostess_membership_id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("manager_membership_id", authContext.membership_id)
      .eq("hostess_membership_id", hostessId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: "HOSTESS_NOT_FOUND", message: "Hostess not found or not assigned to this manager." },
        { status: 404 }
      )
    }

    // Query hostess detail
    const { data: hostess, error: hostessError } = await supabase
      .from("store_memberships")
      .select("user_id, profiles!store_memberships_profile_id_fkey(full_name)")
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .eq("user_id", hostessId)
      .single()

    if (hostessError || !hostess) {
      return NextResponse.json(
        { error: "HOSTESS_NOT_FOUND", message: "Hostess membership not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      hostess: {
        hostess_id: (hostess as any).user_id,
        hostess_name: (hostess as any).profiles.full_name,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
