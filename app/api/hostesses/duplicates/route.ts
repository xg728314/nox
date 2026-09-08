/**
 * GET /api/hostesses/duplicates
 *
 * 매장 내 동명이인 (같은 hostess_name) 그룹 감지.
 *
 * 배경 (R35 · 2026-09-09):
 *   채팅 파서 자동 provisioning · 손동 등록 등으로 같은 이름 아가씨가
 *   여러 membership 으로 생기는 상황. 사장/실장이:
 *     - 같은 사람이면 병합 (merge)
 *     - 다른 사람이면 예명 붙여 구분 (지연 → 지연 (A), 지연 (B))
 *
 * 응답 스키마:
 *   {
 *     groups: [
 *       {
 *         name: "지연",
 *         count: 2,
 *         hostesses: [
 *           {
 *             membership_id, profile_id, hostess_name,
 *             phone, manager_name, manager_membership_id,
 *             created_at, session_count_30d, last_active_at,
 *             is_provisional, is_working
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * 권한: owner + manager (staff.view 필요)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { ensurePerm } from "@/lib/auth/requirePerm"
import { PERMS } from "@/lib/auth/permissions"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const permErr = await ensurePerm(auth, PERMS.STAFF_VIEW)
    if (permErr) return permErr

    const sb = getServiceClient()

    // 1) 매장의 activated hostess membership 조회
    //    (deleted_at 이 있는 것은 이미 병합/삭제된 것이므로 제외)
    //    status 는 approved 뿐 아니라 pending 도 포함 — 파서 auto-provisioning 시 pending 상태로 생성될 수 있음.
    const { data: mems } = await sb.from("store_memberships")
      .select("id, profile_id, role, status, created_at")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .is("deleted_at", null)
    const memList = (mems ?? []) as Array<{
      id: string; profile_id: string; role: string; status: string;
      created_at: string;
    }>

    if (memList.length === 0) return NextResponse.json({ groups: [] })

    // 2) profile 이름 · 전화번호 조회
    const profIds = Array.from(new Set(memList.map(m => m.profile_id)))
    const { data: profs } = await sb.from("profiles")
      .select("id, full_name, phone, created_at")
      .in("id", profIds)
    const profMap = new Map<string, { full_name: string | null; phone: string | null; created_at: string }>()
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; phone: string | null; created_at: string }>) {
      profMap.set(p.id, { full_name: p.full_name, phone: p.phone, created_at: p.created_at })
    }

    // 2.5) hostesses 테이블에서 name + manager_membership_id 조회.
    //      provisional hostess 는 profile.full_name 없이 hostesses.name 에만 저장.
    //      manager_membership_id 도 이 테이블에 있음 (store_memberships 아님).
    const { data: hostRows } = await sb.from("hostesses")
      .select("membership_id, name, manager_membership_id")
      .in("membership_id", memList.map(m => m.id))
      .is("deleted_at", null)
    const hostNameMap = new Map<string, string>()
    const hostMgrMap = new Map<string, string | null>()
    for (const h of (hostRows ?? []) as Array<{ membership_id: string; name: string | null; manager_membership_id: string | null }>) {
      if (h.name) hostNameMap.set(h.membership_id, h.name.trim())
      hostMgrMap.set(h.membership_id, h.manager_membership_id ?? null)
    }

    // 3) manager 이름 lookup — manager_membership_id 는 hostesses 테이블에 있음
    //    (2.5 에서 hostRows 로 이미 조회한 데이터에 manager_membership_id 도 포함되도록 select 확장 필요)
    const mgrIds = Array.from(new Set(
      Array.from(hostMgrMap.values()).filter((x): x is string => !!x),
    ))
    const mgrNameMap = new Map<string, string>()
    if (mgrIds.length > 0) {
      const { data: mgrs } = await sb.from("store_memberships")
        .select("id, profile_id")
        .in("id", mgrIds)
      const mgrProfIds = ((mgrs ?? []) as Array<{ id: string; profile_id: string }>).map(m => m.profile_id)
      const { data: mgrProfs } = mgrProfIds.length > 0
        ? await sb.from("profiles").select("id, full_name").in("id", mgrProfIds)
        : { data: [] as Array<{ id: string; full_name: string | null }> }
      const profNameById = new Map(((mgrProfs ?? []) as Array<{ id: string; full_name: string | null }>).map(p => [p.id, p.full_name ?? "?"]))
      for (const m of (mgrs ?? []) as Array<{ id: string; profile_id: string }>) {
        mgrNameMap.set(m.id, profNameById.get(m.profile_id) ?? "?")
      }
    }

    // 4) 최근 30일 세션 count + 마지막 활동 시각
    //    (조회 크기 관리를 위해 매장 memberships 전체 대신 30일 이내 세션만)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: parts } = await sb.from("session_participants")
      .select("membership_id, entered_at, left_at")
      .eq("store_uuid", auth.store_uuid)
      .in("membership_id", memList.map(m => m.id))
      .gte("entered_at", since)
    const sessionCount = new Map<string, number>()
    const lastActiveAt = new Map<string, string>()
    let workingSet = new Set<string>()
    for (const p of (parts ?? []) as Array<{ membership_id: string; entered_at: string; left_at: string | null }>) {
      sessionCount.set(p.membership_id, (sessionCount.get(p.membership_id) ?? 0) + 1)
      const cur = lastActiveAt.get(p.membership_id)
      const cand = p.left_at ?? p.entered_at
      if (!cur || cand > cur) lastActiveAt.set(p.membership_id, cand)
      if (!p.left_at) workingSet.add(p.membership_id)
    }

    // 5) 조립 + 이름별 그룹화
    type Row = {
      membership_id: string; profile_id: string; hostess_name: string;
      phone: string | null; manager_name: string | null; manager_membership_id: string | null;
      created_at: string; session_count_30d: number; last_active_at: string | null;
      is_working: boolean;
    }
    const rows: Row[] = memList.map(m => {
      const p = profMap.get(m.profile_id)
      // 이름 우선순위: hostesses.name > profiles.full_name (provisional 대응)
      const name = (hostNameMap.get(m.id) ?? "").trim()
        || (p?.full_name ?? "").trim()
        || "(이름 없음)"
      const mgrId = hostMgrMap.get(m.id) ?? null
      return {
        membership_id: m.id,
        profile_id: m.profile_id,
        hostess_name: name,
        phone: p?.phone ?? null,
        manager_name: mgrId ? mgrNameMap.get(mgrId) ?? null : null,
        manager_membership_id: mgrId,
        created_at: m.created_at,
        session_count_30d: sessionCount.get(m.id) ?? 0,
        last_active_at: lastActiveAt.get(m.id) ?? null,
        is_working: workingSet.has(m.id),
      }
    })

    // 이름 정규화 (공백 트림, 소문자 등) — 지금은 exact match 만.
    // "(이름 없음)" 은 그룹핑에서 제외 (전부 몰아서 병합할 대상이 아님)
    const byName = new Map<string, Row[]>()
    for (const r of rows) {
      if (r.hostess_name === "(이름 없음)") continue
      const key = r.hostess_name
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(r)
    }

    const groups = Array.from(byName.entries())
      .filter(([, rs]) => rs.length >= 2)
      .map(([name, rs]) => ({
        name,
        count: rs.length,
        // 최근 활동 우선 정렬 (병합 시 sink 후보)
        hostesses: rs.sort((a, b) => {
          const la = a.last_active_at ?? a.created_at
          const lb = b.last_active_at ?? b.created_at
          return lb.localeCompare(la)
        }),
      }))
      // 개수 많은 그룹 → 최근 활동순
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({ groups, total_groups: groups.length })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
