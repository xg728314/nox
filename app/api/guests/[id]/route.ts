import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("guest_profiles")
      .select("*")
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    const { data: visits } = await supabase
      .from("guest_visits")
      .select("id, session_id, tags, total_amount, tc_count, memo, created_at")
      .eq("guest_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
    return NextResponse.json({ guest: data, visits: visits ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ["display_name", "phone", "tags", "style_prefs", "preferred_staff_ids", "memo", "is_blacklisted", "blacklist_reason"]) {
      if (k in body) patch[k] = body[k]
    }
    const supabase = getServiceClient()
    const { error } = await supabase
      .from("guest_profiles")
      .update(patch)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
