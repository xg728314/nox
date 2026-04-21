import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
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

    let assignedIds: string[] = []

    if (authContext.role === "owner") {
      const { data: allHostesses, error: allHostessesError } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("role", "hostess")
        .eq("status", "approved")

      if (allHostessesError) {
        return NextResponse.json(
          { error: "QUERY_FAILED", message: "Failed to query hostess assignments." },
          { status: 500 }
        )
      }

      assignedIds = (allHostesses ?? []).map((hostess) => hostess.id)
    } else {
      const { data: assignments, error: assignmentsError } = await supabase
        .from("hostesses")
        .select("membership_id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("manager_membership_id", authContext.membership_id)

      if (assignmentsError) {
        return NextResponse.json(
          { error: "QUERY_FAILED", message: "Failed to query hostess assignments." },
          { status: 500 }
        )
      }

      assignedIds = (assignments ?? []).map((assignment) => assignment.membership_id)
    }
    const assignedCount = assignedIds.length

    let preview: { hostess_id: string; hostess_name: string }[] = []

    if (assignedCount > 0) {
      const previewIds = assignedIds.slice(0, 5)

      const { data: hostesses, error: hostessesError } = await supabase
        .from("store_memberships")
        .select("id, profiles!store_memberships_profile_id_fkey(full_name)")
        .eq("store_uuid", authContext.store_uuid)
        .eq("role", "hostess")
        .in("id", previewIds)

      if (!hostessesError && hostesses) {
        preview = hostesses.map((h: { id: string; profiles: { full_name: string }[] | null }) => ({
          hostess_id: h.id,
          hostess_name: h.profiles?.[0]?.full_name ?? "",
        }))
      }
    }

    return NextResponse.json({
      user_id: authContext.user_id,
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      membership_status: authContext.membership_status,
      manager_shell_enabled: authContext.role === "manager",
      visible_sections: [
        "assigned_hostesses",
        "manager_settlement_summary",
        "line_revenue_summary",
      ],
      assigned_hostess_count: assignedCount,
      assigned_hostesses_preview: preview,
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
