/**
 * GET /api/manager-aliases        — 조회 (전 매장 공개)
 * POST /api/manager-aliases       — 등록 (본인 매장 · owner/manager 만)
 * DELETE /api/manager-aliases     — 삭제
 *
 * R-auto-ops (2026-07-08).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const storeUuid = url.searchParams.get("store_uuid")
    const supabase = getServiceClient()
    let query = supabase
      .from("manager_aliases")
      .select("id, store_uuid, membership_id, alias, display_name, usage_count, is_primary, created_at")
      .order("usage_count", { ascending: false })
      .limit(200)
    if (storeUuid) query = query.eq("store_uuid", storeUuid)
    const { data } = await query
    return NextResponse.json({ aliases: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager" && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      membership_id?: string
      alias?: string
      display_name?: string
      is_primary?: boolean
    }
    if (!body.alias?.trim() || !body.display_name?.trim() || !body.membership_id) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    // 대상 membership 이 본 매장인지 확인
    const { data: mem } = await supabase
      .from("store_memberships")
      .select("store_uuid, role")
      .eq("id", body.membership_id)
      .maybeSingle()
    if (!mem) return NextResponse.json({ error: "MEMBERSHIP_NOT_FOUND" }, { status: 404 })
    const m = mem as { store_uuid: string; role: string }
    if (m.store_uuid !== auth.store_uuid && !auth.is_super_admin) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const { error } = await supabase.from("manager_aliases").upsert(
      {
        store_uuid: m.store_uuid,
        membership_id: body.membership_id,
        alias: body.alias.trim().slice(0, 8),
        display_name: body.display_name.trim().slice(0, 40),
        is_primary: !!body.is_primary,
      },
      { onConflict: "store_uuid,alias" },
    )
    if (error) {
      return NextResponse.json({ error: "UPSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const supabase = getServiceClient()
    await supabase
      .from("manager_aliases")
      .delete()
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
