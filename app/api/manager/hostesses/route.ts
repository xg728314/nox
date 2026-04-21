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

    let hostessIds: string[] = []

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

      hostessIds = (allHostesses ?? []).map((hostess) => hostess.id)
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

      hostessIds = (assignments ?? []).map((assignment) => assignment.membership_id)
    }

    if (hostessIds.length === 0) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        role: authContext.role,
        hostesses: [],
      })
    }

    const { data: hostesses, error: hostessesError } = await supabase
      .from("store_memberships")
      .select("id, profiles!store_memberships_profile_id_fkey(full_name)")
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .in("id", hostessIds)

    if (hostessesError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query hostess details." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      hostesses: (hostesses ?? []).map((h: { id: string; profiles: { full_name: string }[] | null }) => ({
        hostess_id: h.id,
        hostess_name: h.profiles?.[0]?.full_name ?? "",
      })),
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
