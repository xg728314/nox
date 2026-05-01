import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
  status: string
  store_uuid: string
  normalized_name?: string
  store_name?: string | null
  manager_membership_id?: string | null
  manager_name?: string | null
  is_active_today?: boolean | null
  recent_assignment_score?: number | null
}

export type StoreStaffResponse = {
  store_uuid: string | null
  store_name: string | null
  staff: StaffMember[]
}

export type StoreStaffParams = {
  store_name?: string | null
  store_uuid?: string | null
  role?: string | null
}

/**
 * ROUND-STAFF-1: manager 권한일 때 hostess 리스트를 본인 담당만으로 축소.
 * ROUND-STAFF-2: visibility mode 파라미터로 "store_shared" 허용.
 *   - super_admin / owner → 원본 그대로
 *   - manager (non-owner / non-super_admin):
 *       visibilityMode="mine_only" (기본)  → manager_membership_id === auth.membership_id 만
 *       visibilityMode="store_shared"      → 필터 없음 (같은 매장 전체; 이미 store_uuid scope 로 제한됨)
 *   - manager rows 는 어느 모드든 자신 포함 유지 (role !== "hostess" 은 필터 미적용)
 *
 * 주의: 이 filter 는 **조회 가시성** 만 다룬다. 출근 ON/OFF 등 조작은
 *   각 mutating route 가 manager_membership_id 자기담당 체크로 독립 시행.
 */
function filterByManagerScope(
  staff: StaffMember[],
  auth: AuthContext,
  visibilityMode: "mine_only" | "store_shared" = "mine_only",
): StaffMember[] {
  if (auth.is_super_admin || auth.role === "owner") return staff
  if (auth.role !== "manager") return staff
  if (visibilityMode === "store_shared") return staff
  return staff.filter((s) => {
    if (s.role !== "hostess") return true
    return s.manager_membership_id === auth.membership_id
  })
}

export async function getStoreStaff(
  auth: AuthContext,
  params: StoreStaffParams = {},
  opts: { visibilityMode?: "mine_only" | "store_shared" } = {},
): Promise<StoreStaffResponse> {
  const supabase = getServiceClient()
  const visibilityMode = opts.visibilityMode ?? "mine_only"

  const storeNameParam = params.store_name ?? null
  const storeUuidParam = params.store_uuid ?? null
  const roleParam = params.role ?? null

  if (storeNameParam) {
    const normalized = storeNameParam.trim()
    const { data: storeData, error: storeErr } = await supabase
      .from("stores")
      .select("id")
      .eq("store_name", normalized)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()

    if (storeErr) throw new Error(storeErr.message)

    if (!storeData) {
      return {
        store_uuid: null,
        store_name: storeNameParam,
        staff: [],
      }
    }

    const storeRole = roleParam === "manager" || roleParam === "hostess" ? roleParam : "hostess"
    const { data: members, error: membersError } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, profile_id, role")
      .eq("role", storeRole)
      .eq("store_uuid", storeData.id)
      .eq("status", "approved")
      .is("deleted_at", null)

    if (membersError) throw new Error(membersError.message)

    const membersRows = (members ?? []) as { id: string; store_uuid: string; profile_id: string | null; role: string }[]
    const membershipIds = membersRows.map(m => m.id)
    const profileIds = membersRows.map(m => m.profile_id).filter((pid): pid is string => !!pid)

    const profileNameMap = new Map<string, string>()
    if (profileIds.length > 0) {
      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds)
      if (profsErr) throw new Error(profsErr.message)
      for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) profileNameMap.set(p.id, p.full_name)
      }
    }

    if (storeRole === "manager") {
      const mgrNameMap = new Map<string, string>()
      if (membershipIds.length > 0) {
        const { data: mgrs } = await supabase
          .from("managers")
          .select("membership_id, name")
          .in("membership_id", membershipIds)
          .eq("store_uuid", storeData.id)
          .is("deleted_at", null)
        for (const m of (mgrs ?? []) as { membership_id: string; name: string }[]) {
          mgrNameMap.set(m.membership_id, m.name)
        }
      }

      const staff: StaffMember[] = membersRows.map(m => ({
        id: m.id,
        membership_id: m.id,
        name: mgrNameMap.get(m.id) || (m.profile_id ? profileNameMap.get(m.profile_id) : undefined) || "이름 없음",
        role: "manager",
        status: "approved",
        store_uuid: m.store_uuid,
      }))

      return {
        store_uuid: storeData.id,
        store_name: storeNameParam,
        staff,
      }
    }

    // hostess path
    const stageNameMap = new Map<string, string>()
    const hostessManagerMap = new Map<string, string | null>()
    if (membershipIds.length > 0) {
      const { data: hsts, error: hstsErr } = await supabase
        .from("hostesses")
        .select("membership_id, name, stage_name, manager_membership_id")
        .in("membership_id", membershipIds)
        .eq("store_uuid", storeData.id)
        .is("deleted_at", null)
      if (hstsErr) throw new Error(hstsErr.message)
      for (const h of (hsts ?? []) as { membership_id: string; name: string | null; stage_name: string | null; manager_membership_id: string | null }[]) {
        const display = h.name || h.stage_name
        if (display) stageNameMap.set(h.membership_id, display)
        hostessManagerMap.set(h.membership_id, h.manager_membership_id ?? null)
      }
    }

    const mgrIds = [...hostessManagerMap.values()].filter((id): id is string => !!id)
    const mgrNameMap = new Map<string, string>()
    if (mgrIds.length > 0) {
      const { data: mgrs } = await supabase
        .from("managers")
        .select("membership_id, name")
        .in("membership_id", [...new Set(mgrIds)])
        .eq("store_uuid", storeData.id)
        .is("deleted_at", null)
      for (const m of (mgrs ?? []) as { membership_id: string; name: string }[]) {
        mgrNameMap.set(m.membership_id, m.name)
      }
    }

    const staff: StaffMember[] = membersRows.map(m => {
      const mgrMid = hostessManagerMap.get(m.id) ?? null
      return {
        id: m.id,
        membership_id: m.id,
        name: stageNameMap.get(m.id) || (m.profile_id ? profileNameMap.get(m.profile_id) : undefined) || "이름 없음",
        role: "hostess",
        status: "approved",
        store_uuid: m.store_uuid,
        manager_membership_id: mgrMid,
        manager_name: mgrMid ? (mgrNameMap.get(mgrMid) ?? null) : null,
      }
    })

    return {
      store_uuid: storeData.id,
      store_name: storeNameParam,
      staff: filterByManagerScope(staff, auth, visibilityMode),
    }
  }

  // store_name missing → auth scope
  const targetStoreUuid = storeUuidParam ?? auth.store_uuid

  const rolesFilter = roleParam === "manager" || roleParam === "hostess"
    ? [roleParam]
    : ["manager", "hostess"]

  const { data: members, error: membersError } = await supabase
    .from("store_memberships")
    .select("id, role, status, store_uuid, profiles!profile_id(full_name)")
    .eq("store_uuid", targetStoreUuid)
    .in("role", rolesFilter)
    .eq("status", "approved")
    .is("deleted_at", null)

  if (membersError) {
    throw new Error(membersError.message || "Failed to query staff.")
  }

  const membershipIds = (members ?? []).map((m: { id: string }) => m.id)

  const stageNameMap = new Map<string, string>()

  // 2026-05-01 R-Staff-Speed: managers + hostesses 병렬 fetch (직렬 → Promise.all).
  if (membershipIds.length > 0) {
    const [mgrsRes, hstsRes] = await Promise.all([
      supabase
        .from("managers")
        .select("membership_id, name")
        .in("membership_id", membershipIds)
        .eq("store_uuid", targetStoreUuid)
        .is("deleted_at", null),
      supabase
        .from("hostesses")
        .select("membership_id, name")
        .in("membership_id", membershipIds)
        .eq("store_uuid", targetStoreUuid)
        .is("deleted_at", null),
    ])
    for (const m of mgrsRes.data ?? []) stageNameMap.set(m.membership_id, m.name)
    for (const h of hstsRes.data ?? []) stageNameMap.set(h.membership_id, h.name)
  }

  type MemberRow = { id: string; role: string; status: string; store_uuid: string; profiles: { full_name: string } | null }
  const memberRows = (members ?? []) as unknown as MemberRow[]

  const staff: StaffMember[] = memberRows.map(m => ({
    id: m.id,
    membership_id: m.id,
    name: stageNameMap.get(m.id) || m.profiles?.full_name || "이름 없음",
    role: m.role,
    status: m.status,
    store_uuid: m.store_uuid,
  }))

  let storeName: string | null = null

  if (roleParam === "hostess" && memberRows.length > 0) {
    try {
      const hostessMembershipIds = memberRows.map(m => m.id)
      const now = Date.now()
      const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

      // 2026-05-01 R-Staff-Speed: 직렬 3-4 query → Promise.all 병렬.
      //   기존: stores → hostesses → managers → session_participants (직렬, 1-4초)
      //   현재: 3 query 병렬 + manager fetch 만 의존 (managerIds 필요).
      const [storeRes, hstsRes, sp7Res] = await Promise.all([
        supabase
          .from("stores")
          .select("store_name")
          .eq("id", targetStoreUuid)
          .maybeSingle(),
        supabase
          .from("hostesses")
          .select("membership_id, manager_membership_id")
          .in("membership_id", hostessMembershipIds)
          .eq("store_uuid", targetStoreUuid)
          .is("deleted_at", null),
        supabase
          .from("session_participants")
          .select("membership_id, created_at")
          .in("membership_id", hostessMembershipIds)
          .eq("store_uuid", targetStoreUuid)
          .is("deleted_at", null)
          .gte("created_at", since7d),
      ])

      storeName = (storeRes.data as { store_name?: string | null } | null)?.store_name ?? null

      const hostessManagerMap = new Map<string, string | null>()
      for (const h of (hstsRes.data ?? []) as { membership_id: string; manager_membership_id: string | null }[]) {
        hostessManagerMap.set(h.membership_id, h.manager_membership_id ?? null)
      }

      const managerNameMap = new Map<string, string>()
      const managerIds = [...new Set([...hostessManagerMap.values()].filter((v): v is string => !!v))]
      if (managerIds.length > 0) {
        try {
          const { data: mgrs } = await supabase
            .from("managers")
            .select("membership_id, name")
            .in("membership_id", managerIds)
            .eq("store_uuid", targetStoreUuid)
            .is("deleted_at", null)
          for (const mgr of (mgrs ?? []) as { membership_id: string; name: string }[]) {
            managerNameMap.set(mgr.membership_id, mgr.name)
          }
        } catch { /* ignore */ }
      }

      const activeTodaySet = new Set<string>()
      const recentCount = new Map<string, number>()
      for (const row of (sp7Res.data ?? []) as { membership_id: string | null; created_at: string }[]) {
        if (!row.membership_id) continue
        recentCount.set(row.membership_id, (recentCount.get(row.membership_id) ?? 0) + 1)
        if (row.created_at >= since24h) activeTodaySet.add(row.membership_id)
      }

      const normalize = (s: string) => (s ?? "").replace(/\s+/g, "").trim()

      for (const row of staff) {
        const mgrMid = hostessManagerMap.get(row.id) ?? null
        row.normalized_name = normalize(row.name)
        row.store_name = storeName
        row.manager_membership_id = mgrMid
        row.manager_name = mgrMid ? (managerNameMap.get(mgrMid) ?? null) : null
        row.is_active_today = activeTodaySet.has(row.id)
        const cnt = recentCount.get(row.id) ?? 0
        row.recent_assignment_score = Math.max(0, Math.min(10, cnt))
      }
    } catch (e) {
      console.warn("hostess enrichment failed:", e instanceof Error ? e.message : String(e))
    }
  }

  return {
    store_uuid: targetStoreUuid,
    store_name: storeNameParam ?? storeName,
    staff: filterByManagerScope(staff, auth, visibilityMode),
  }
}
