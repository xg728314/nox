/**
 * /api/store/managers — 매장 실장 관리
 *
 * GET: 매장 owner/manager 목록 (본 매장 · owner 만)
 * POST: 초대 (별도 flow · 지금은 미구현)
 *
 * R-manager-mgmt (2026-09-04): 실장 그만두면 매장 정보 못 보게.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "사장만 열람 가능" }, { status: 403 })
    }

    const sb = getServiceClient()
    // 본 매장의 모든 owner/manager membership
    const { data: mems } = await sb.from("store_memberships")
      .select("id, profile_id, role, status, is_primary, created_at, deleted_at")
      .eq("store_uuid", auth.store_uuid)
      .in("role", ["owner", "manager"])
      .order("created_at", { ascending: true })

    const rows = (mems ?? []) as Array<{
      id: string; profile_id: string; role: string; status: string;
      is_primary: boolean; created_at: string; deleted_at: string | null
    }>

    // profile lookup
    const profIds = [...new Set(rows.map(r => r.profile_id).filter(Boolean))]
    const profsRes = profIds.length
      ? await sb.from("profiles").select("id, full_name, phone").in("id", profIds)
      : { data: [] as Array<{ id: string; full_name?: string; phone?: string }> }
    const profs = (profsRes.data ?? []) as Array<{ id: string; full_name?: string; phone?: string }>
    const profMap = new Map(profs.map(p => [p.id, p]))

    const items = rows.map(r => {
      const p = profMap.get(r.profile_id)
      return {
        membership_id: r.id,
        profile_id: r.profile_id,
        full_name: p?.full_name ?? "?",
        phone: p?.phone ?? null,
        role: r.role,
        status: r.status,
        is_primary: r.is_primary,
        created_at: r.created_at,
        deleted_at: r.deleted_at,
        is_active: r.status === "approved" && !r.deleted_at,
      }
    })

    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
