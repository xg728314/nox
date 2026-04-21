import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 오늘 영업일
    const today = new Date().toISOString().split("T")[0]
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    if (!bizDay) {
      return NextResponse.json({ attendance: null })
    }

    const { data: record } = await supabase
      .from("staff_attendance")
      .select("id, status, checked_in_at, checked_out_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", bizDay.id)
      .eq("membership_id", authContext.membership_id)
      .order("checked_in_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      attendance: record ? {
        status: record.status,
        checked_in_at: record.checked_in_at,
        checked_out_at: record.checked_out_at,
      } : null,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
