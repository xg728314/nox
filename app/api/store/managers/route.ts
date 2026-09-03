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
import { effectivePermissions, PERMS, hasPerm } from "@/lib/auth/permissions"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // R-manager-perms (2026-09-04): owner + super_admin + delegated (managers.manage)
    let canView = auth.role === "owner" || auth.is_super_admin
    if (!canView && auth.role === "manager") {
      const sbAuth = getServiceClient()
      const { data: myMem } = await sbAuth.from("store_memberships")
        .select("permissions").eq("id", auth.membership_id).maybeSingle()
      const myPerms = effectivePermissions(
        auth.role,
        (myMem as { permissions?: Record<string, boolean> | null } | null)?.permissions ?? null,
      )
      if (hasPerm(myPerms, PERMS.MANAGERS_MANAGE)) canView = true
    }
    if (!canView) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "사장 또는 위임된 실장만 열람 가능" }, { status: 403 })
    }

    const sb = getServiceClient()
    // 본 매장의 모든 owner/manager membership
    const { data: mems } = await sb.from("store_memberships")
      .select("id, profile_id, role, status, is_primary, created_at, deleted_at, permissions")
      .eq("store_uuid", auth.store_uuid)
      .in("role", ["owner", "manager"])
      .order("created_at", { ascending: true })

    const rows = (mems ?? []) as Array<{
      id: string; profile_id: string; role: string; status: string;
      is_primary: boolean; created_at: string; deleted_at: string | null;
      permissions: Record<string, boolean> | null
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
        // R-manager-perms (2026-09-04): 세부 권한 원본 (owner 는 null · 항상 전권)
        permissions: r.role === "owner" ? null : r.permissions,
      }
    })

    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
