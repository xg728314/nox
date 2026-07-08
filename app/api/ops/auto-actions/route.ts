/**
 * GET /api/ops/auto-actions?limit=100  — 자동 처리 이력 조회 (owner/manager).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager" && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("chat_auto_actions")
      .select(
        "id, chat_message_id, action_type, parsed_json, ref_id, ref_table, status, error_message, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit)
    return NextResponse.json({ actions: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
