import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "AUTH_MISSING" }, { status: 401 })
    }
    const token = authHeader.slice(7).trim()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData.user) {
      return NextResponse.json({ error: "AUTH_INVALID" }, { status: 401 })
    }

    const { data: memberships, error: memError } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, role, status, is_primary")
      .eq("profile_id", userData.user.id)
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })

    if (memError) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    // store 이름 조회
    type MembershipRow = { id: string; store_uuid: string; role: string; is_primary: boolean }
    const storeUuids = [...new Set((memberships ?? []).map((m: MembershipRow) => m.store_uuid))]
    const storeMap = new Map<string, string>()
    if (storeUuids.length > 0) {
      const { data: stores } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", storeUuids)

      for (const s of stores ?? []) {
        storeMap.set(s.id, s.store_name)
      }
    }

    const enriched = (memberships ?? []).map((m: MembershipRow) => ({
      membership_id: m.id,
      store_uuid: m.store_uuid,
      store_name: storeMap.get(m.store_uuid) || "",
      role: m.role,
      is_primary: m.is_primary,
    }))

    return NextResponse.json({
      user_id: userData.user.id,
      memberships: enriched,
    })
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
