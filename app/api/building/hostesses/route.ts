import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { cached } from "@/lib/cache/inMemoryTtl"

// R-mobile (2026-06-01): 스태프동기화 모바일 앱이 + 버튼 시트에서
//   - 내 식구 빠른 선택
//   - 동명이인 disambig (같은 이름 → 담당실장 + 매장 hint 노출)
//   - 다른 매장 hostess 검색 (cross-store visit 시 도착 store 의 실장이
//     본인 식구가 아닌 hostess 도 인지해야 함)
//   세 가지를 한 번에 지원하기 위해 건물 전체 (5~8F) hostess 목록을 반환.
//
//   응답 각 row 에는 hostess + 담당실장 이름 + 본거지(=working) 매장명 + 원소속 매장명
//   까지 포함되어 클라이언트가 추가 fetch 없이 disambig 가능.
//
//   캐시: 30초. hostess 추가/role 변경은 흔하지 않으나 (월 단위), TTL 짧게
//   잡아 신규 등록자가 곧 보이도록.
const BUILDING_HOSTESSES_TTL_MS = 30_000

type MembershipRow = {
  id: string
  profile_id: string
  store_uuid: string
}
type ProfileRow = { id: string; full_name: string | null }
type StoreRow = { id: string; store_name: string; floor: number | null }
type HostessRow = {
  membership_id: string
  manager_membership_id: string | null
  origin_store_uuid: string | null
}

export async function GET(request: Request) {
  try {
    // 인증된 사용자면 누구나. 매장 무관 (전체 가시성 필요).
    await resolveAuthContext(request)

    const payload = await cached<{
      hostesses: Array<{
        hostess_id: string
        membership_id: string
        profile_id: string
        hostess_name: string
        store_uuid: string
        store_name: string
        floor: number | null
        manager_membership_id: string | null
        manager_name: string
        origin_store_uuid: string | null
        origin_store_name: string
      }>
    }>("building_hostesses", "v1", BUILDING_HOSTESSES_TTL_MS, async () => {
      const sb = getServiceClient()

      // 1) 5~8F stores
      const { data: storesData, error: storesError } = await sb
        .from("stores")
        .select("id, store_name, floor")
        .is("deleted_at", null)
        .in("floor", [5, 6, 7, 8])
      if (storesError) throw new Error("STORES_QUERY_FAILED")
      const storeMap = new Map<string, StoreRow>()
      for (const s of (storesData as StoreRow[] | null) ?? []) {
        storeMap.set(s.id, s)
      }
      const storeIds = Array.from(storeMap.keys())
      if (storeIds.length === 0) return { hostesses: [] }

      // 2) 모든 hostess 멤버십 (5~8F 매장만)
      const { data: memData, error: memError } = await sb
        .from("store_memberships")
        .select("id, profile_id, store_uuid")
        .eq("role", "hostess")
        .eq("status", "approved")
        .is("deleted_at", null)
        .in("store_uuid", storeIds)
      if (memError) throw new Error("MEMBERSHIPS_QUERY_FAILED")
      const memRows = (memData as MembershipRow[] | null) ?? []
      if (memRows.length === 0) return { hostesses: [] }

      const profileIds = Array.from(new Set(memRows.map((m) => m.profile_id)))
      const memIds = memRows.map((m) => m.id)

      // R-chunked-in (2026-08-24): 5-8F 매장 전체 hostess 는 수백 명. `.in()` URL
      //   초과로 `fetch failed` silent · 이전엔 500 PROFILES_QUERY_FAILED · 채팅
      //   auto-fire 매칭 완전 실패 (사용자 리포트 "자동등록 안된다").
      //   Chunked helper (100개씩) 로 병렬 fetch + concat.
      const IN_CHUNK = 100
      function chunk<T>(arr: T[], n: number): T[][] {
        const out: T[][] = []
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
        return out
      }
      async function chunkedIn<Row>(build: (ids: string[]) => Promise<{ data: Row[] | null; error: unknown }>, ids: string[]): Promise<{ data: Row[]; error: unknown | null }> {
        const chunks = chunk(ids, IN_CHUNK)
        const results = await Promise.all(chunks.map((c) => build(c)))
        const rows: Row[] = []
        let firstErr: unknown | null = null
        for (const r of results) {
          if (r.error && !firstErr) firstErr = r.error
          if (r.data) rows.push(...r.data)
        }
        return { data: rows, error: firstErr }
      }

      // 3) Hostess 프로파일 + 4) hostesses 부가행 (manager_membership_id / origin)
      const [profilesRes, hostessRes] = await Promise.all([
        chunkedIn<ProfileRow>(async (ids) => {
          const { data, error } = await sb
            .from("profiles")
            .select("id, full_name")
            .in("id", ids)
          return { data: data as ProfileRow[] | null, error }
        }, profileIds),
        chunkedIn<HostessRow>(async (ids) => {
          const { data, error } = await sb
            .from("hostesses")
            .select("membership_id, manager_membership_id, origin_store_uuid")
            .in("membership_id", ids)
          return { data: data as HostessRow[] | null, error }
        }, memIds),
      ])
      if (profilesRes.error) throw new Error(`PROFILES_QUERY_FAILED: ${String(profilesRes.error)}`)
      const nameMap = new Map<string, string>()
      for (const p of profilesRes.data) {
        nameMap.set(p.id, p.full_name ?? "")
      }
      const hostessMap = new Map<string, HostessRow>()
      for (const h of hostessRes.data) {
        hostessMap.set(h.membership_id, h)
      }

      // 5) 담당실장 이름 — manager_membership_id 들의 profile_id 조회 → profiles.full_name
      const managerMemIds = Array.from(
        new Set(
          Array.from(hostessMap.values())
            .map((h) => h.manager_membership_id)
            .filter((x): x is string => !!x),
        ),
      )
      const managerNameMap = new Map<string, string>()
      if (managerMemIds.length > 0) {
        const { data: mgrMems } = await sb
          .from("store_memberships")
          .select("id, profile_id")
          .in("id", managerMemIds)
        const mgrMemRows = (mgrMems as Array<{ id: string; profile_id: string }> | null) ?? []
        const mgrProfileIds = Array.from(new Set(mgrMemRows.map((m) => m.profile_id)))
        if (mgrProfileIds.length > 0) {
          const { data: mgrProfiles } = await sb
            .from("profiles")
            .select("id, full_name")
            .in("id", mgrProfileIds)
          const mgrNameByProfile = new Map<string, string>()
          for (const p of (mgrProfiles as ProfileRow[] | null) ?? []) {
            mgrNameByProfile.set(p.id, p.full_name ?? "")
          }
          for (const mm of mgrMemRows) {
            managerNameMap.set(mm.id, mgrNameByProfile.get(mm.profile_id) ?? "")
          }
        }
      }

      const hostesses = memRows
        .map((m) => {
          const hostessRow = hostessMap.get(m.id)
          const store = storeMap.get(m.store_uuid)
          const originStore = hostessRow?.origin_store_uuid
            ? storeMap.get(hostessRow.origin_store_uuid)
            : null
          return {
            hostess_id: m.id,
            membership_id: m.id,
            profile_id: m.profile_id,
            hostess_name: nameMap.get(m.profile_id) ?? "",
            store_uuid: m.store_uuid,
            store_name: store?.store_name ?? "",
            floor: store?.floor ?? null,
            manager_membership_id: hostessRow?.manager_membership_id ?? null,
            manager_name: hostessRow?.manager_membership_id
              ? managerNameMap.get(hostessRow.manager_membership_id) ?? ""
              : "",
            origin_store_uuid: hostessRow?.origin_store_uuid ?? null,
            origin_store_name: originStore?.store_name ?? "",
          }
        })
        .sort((a, b) => a.hostess_name.localeCompare(b.hostess_name, "ko"))

      return { hostesses }
    })

    const res = NextResponse.json(payload)
    res.headers.set("Cache-Control", "private, max-age=20, stale-while-revalidate=120")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.type, message: error.message },
        { status: error.status },
      )
    }
    const msg = error instanceof Error ? error.message : "Unexpected error."
    return NextResponse.json(
      { error: "QUERY_FAILED", message: msg },
      { status: 500 },
    )
  }
}
