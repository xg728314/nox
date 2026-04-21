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

    // Query params
    const { searchParams } = new URL(request.url)
    const storeNameParam = searchParams.get("store_name")
    const storeUuidParam = searchParams.get("store_uuid")
    const roleParam = searchParams.get("role")

    // store_name 파라미터 있으면 해당 매장 아가씨 조회, 없으면 auth scope
    if (storeNameParam) {
      try {
        // 1) stores 테이블에서 store_name으로 store_uuid 조회.
        //
        // Hardening (locked 2026-04-18):
        //   이전: `.ilike("store_name", "%${name}%")` — substring match.
        //         새 매장명이 기존 매장명의 substring이거나 반대인 경우
        //         (예: "라이브" vs "라이브2") 복수 행이 반환되어
        //         `.maybeSingle()`이 PGRST116 에러를 던지거나, 부분
        //         일치로 엉뚱한 가게가 선택될 수 있음.
        //   현재: 공백 trim 후 `.eq("store_name", trimmed)` exact-match.
        //         storeRegistry 의 label 과 DB의 store_name 이 정확히
        //         일치하는 것을 전제로, 모호성을 완전히 제거한다.
        //         `.limit(1).maybeSingle()` 로 보조 방어선까지 둔다.
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
          return NextResponse.json({
            store_uuid: null,
            store_name: storeNameParam,
            staff: [],
          })
        }

        // 2) store_uuid로 멤버십 조회 — role 파라미터가 있으면 해당 역할만
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

        // 3) profile_id 목록으로 profiles.full_name 별도 조회
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
          // manager 조회: managers 테이블에서 이름 조회
          const mgrNameMap = new Map<string, string>()
          if (membershipIds.length > 0) {
            const { data: mgrs } = await supabase
              .from("managers")
              .select("membership_id, name")
              .in("membership_id", membershipIds)
            for (const m of (mgrs ?? []) as { membership_id: string; name: string }[]) {
              mgrNameMap.set(m.membership_id, m.name)
            }
          }

          const staff = membersRows.map(m => ({
            id: m.id,
            membership_id: m.id,
            name: mgrNameMap.get(m.id) || (m.profile_id ? profileNameMap.get(m.profile_id) : undefined) || "이름 없음",
            role: "manager",
            status: "approved",
            store_uuid: m.store_uuid,
          }))

          return NextResponse.json({
            store_uuid: storeData.id,
            store_name: storeNameParam,
            staff,
          })
        }

        // hostess 조회: hostesses 테이블에서 활동명 + 담당실장 조회
        const stageNameMap = new Map<string, string>()
        const hostessManagerMap = new Map<string, string | null>()
        if (membershipIds.length > 0) {
          const { data: hsts, error: hstsErr } = await supabase
            .from("hostesses")
            .select("membership_id, name, stage_name, manager_membership_id")
            .in("membership_id", membershipIds)
          if (hstsErr) throw new Error(hstsErr.message)
          for (const h of (hsts ?? []) as { membership_id: string; name: string | null; stage_name: string | null; manager_membership_id: string | null }[]) {
            const display = h.name || h.stage_name
            if (display) stageNameMap.set(h.membership_id, display)
            hostessManagerMap.set(h.membership_id, h.manager_membership_id ?? null)
          }
        }

        // 담당실장 이름 일괄 조회
        const mgrIds = [...hostessManagerMap.values()].filter((id): id is string => !!id)
        const mgrNameMap = new Map<string, string>()
        if (mgrIds.length > 0) {
          const { data: mgrs } = await supabase
            .from("managers")
            .select("membership_id, name")
            .in("membership_id", [...new Set(mgrIds)])
          for (const m of (mgrs ?? []) as { membership_id: string; name: string }[]) {
            mgrNameMap.set(m.membership_id, m.name)
          }
        }

        // 응답 조립
        const staff = membersRows.map(m => {
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

        return NextResponse.json({
          store_uuid: storeData.id,
          store_name: storeNameParam,
          staff,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err)
        console.error("store staff error:", msg)
        return NextResponse.json(
          { error: "QUERY_FAILED", message: msg },
          { status: 500 }
        )
      }
    }

    // store_name 없으면 기존 로직: auth scope 기준 전체 스태프 조회
    const targetStoreUuid = storeUuidParam ?? authContext.store_uuid

    // 역할 필터: role 파라미터가 유효하면 해당 역할만, 아니면 manager+hostess
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
      return NextResponse.json(
        { error: "QUERY_FAILED", message: membersError.message || "Failed to query staff." },
        { status: 500 }
      )
    }

    const membershipIds = (members ?? []).map((m: { id: string }) => m.id)

    // Lookup stage names from managers/hostesses tables
    const stageNameMap = new Map<string, string>()

    if (membershipIds.length > 0) {
      const { data: mgrs } = await supabase
        .from("managers")
        .select("membership_id, name")
        .in("membership_id", membershipIds)

      const { data: hsts } = await supabase
        .from("hostesses")
        .select("membership_id, name")
        .in("membership_id", membershipIds)

      for (const m of mgrs ?? []) stageNameMap.set(m.membership_id, m.name)
      for (const h of hsts ?? []) stageNameMap.set(h.membership_id, h.name)
    }

    type MemberRow = { id: string; role: string; status: string; store_uuid: string; profiles: { full_name: string } | null }
    const memberRows = (members ?? []) as unknown as MemberRow[]

    // Base staff rows (unchanged shape for back-compat).
    const staff: Array<{
      id: string
      membership_id: string
      name: string
      role: string
      status: string
      store_uuid: string
      // Hostess-only enrichment fields (optional, present when role=hostess).
      normalized_name?: string
      store_name?: string | null
      manager_membership_id?: string | null
      manager_name?: string | null
      is_active_today?: boolean | null
      recent_assignment_score?: number | null
    }> = memberRows.map(m => ({
      id: m.id,
      membership_id: m.id,
      name: stageNameMap.get(m.id) || m.profiles?.full_name || "이름 없음",
      role: m.role,
      status: m.status,
      store_uuid: m.store_uuid,
    }))

    let storeName: string | null = null

    // ── Hostess context enrichment (read-only, additive) ─────────────
    //
    // Only runs when the caller explicitly asked for hostesses. Produces
    // the HostessMatchCandidate-shaped fields consumed by the counter
    // name-match overlay. Failure in any enrichment step is swallowed —
    // the base staff list is always returned (fallback path).
    if (roleParam === "hostess" && memberRows.length > 0) {
      try {
        // Resolve store_name for this store (displayed in cross-store case
        // only, but included here for completeness).
        try {
          const { data: storeRow } = await supabase
            .from("stores")
            .select("store_name")
            .eq("id", targetStoreUuid)
            .maybeSingle()
          storeName = (storeRow as { store_name?: string | null } | null)?.store_name ?? null
        } catch { /* ignore */ }

        const hostessMembershipIds = memberRows.map(m => m.id)

        // Manager linkage (via hostesses.manager_membership_id).
        const hostessManagerMap = new Map<string, string | null>()
        try {
          const { data: hsts } = await supabase
            .from("hostesses")
            .select("membership_id, manager_membership_id")
            .in("membership_id", hostessMembershipIds)
          for (const h of (hsts ?? []) as { membership_id: string; manager_membership_id: string | null }[]) {
            hostessManagerMap.set(h.membership_id, h.manager_membership_id ?? null)
          }
        } catch { /* ignore */ }

        const managerNameMap = new Map<string, string>()
        const managerIds = [...new Set([...hostessManagerMap.values()].filter((v): v is string => !!v))]
        if (managerIds.length > 0) {
          try {
            const { data: mgrs } = await supabase
              .from("managers")
              .select("membership_id, name")
              .in("membership_id", managerIds)
            for (const mgr of (mgrs ?? []) as { membership_id: string; name: string }[]) {
              managerNameMap.set(mgr.membership_id, mgr.name)
            }
          } catch { /* ignore */ }
        }

        // Recent-activity counts (rolling 24h → is_active_today flag;
        // rolling 7d → assignment score clamped to 0..10).
        const now = Date.now()
        const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
        const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

        const activeTodaySet = new Set<string>()
        const recentCount = new Map<string, number>()
        try {
          const { data: sp7 } = await supabase
            .from("session_participants")
            .select("membership_id, created_at")
            .in("membership_id", hostessMembershipIds)
            .gte("created_at", since7d)
          for (const row of (sp7 ?? []) as { membership_id: string | null; created_at: string }[]) {
            if (!row.membership_id) continue
            recentCount.set(row.membership_id, (recentCount.get(row.membership_id) ?? 0) + 1)
            if (row.created_at >= since24h) activeTodaySet.add(row.membership_id)
          }
        } catch { /* ignore */ }

        // Normalize names — strip whitespace. Defined here so route and
        // client agree on the canonical form.
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
        // Enrichment failed — return base staff rows (fallback to v1).
        console.warn("hostess enrichment failed:", e instanceof Error ? e.message : String(e))
      }
    }

    return NextResponse.json({
      store_uuid: targetStoreUuid,
      store_name: storeNameParam ?? storeName,
      staff,
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
