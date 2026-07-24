import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { cached } from "@/lib/cache/inMemoryTtl"
import { BUILDING_FLOORS, isCafeFloor } from "@/lib/building/floors"

// R-external-dispatch (2026-07-24): 모바일 앱 하단 탭 "외부조판" 뷰 (프로토타입
//   /m/staff 재구현). 매장별 방 그리드를 한 화면에서 관측.
//
//   Scope:
//     - super_admin        → 건물 전체 (5~8F) 모든 매장
//     - owner/manager      → 자기 store_uuid 만 (실질 same as /api/rooms 확장)
//     - hostess/waiter/staff → 403
//
//   응답에는 각 방의 활성 세션 + 참여자 리스트 + 담당실장 이름 + 종목 집합 (P/H/S)
//   까지 aggregate. 프로토타입 참고본에 맞춤.
//
//   캐시: 8초 (원본 /api/rooms 는 10초, 외부조판은 조금 더 짧게 잡아 신규 체크인
//         반영 지연 최소화).

const BUILDING_ROOMS_TTL_MS = 8_000

type StoreRow = { id: string; store_name: string; floor: number | null }
type RoomRow = {
  id: string
  store_uuid: string
  room_no: string
  room_name: string
  is_active: boolean
  floor_no: number | null
  sort_order: number | null
}
type SessionRow = {
  id: string
  store_uuid: string
  room_uuid: string
  status: string
  started_at: string
  ended_at: string | null
  manager_name: string | null
  manager_membership_id: string | null
  customer_name_snapshot: string | null
  customer_party_size: number | null
}
type ParticipantRow = {
  id: string
  session_id: string
  membership_id: string | null
  external_name: string | null
  category: string | null
  time_minutes: number
  status: string
  origin_store_uuid: string | null
  memo: string | null
}
type MembershipRow = { id: string; profile_id: string; store_uuid: string }
type ProfileRow = { id: string; full_name: string | null }

// 프로토타입 종목 축약 (P/H/S) — 서버에서 계산해 반환 (클라 hardcode 방지).
function categoryToLetter(category: string | null): "P" | "H" | "S" | null {
  if (category === "퍼블릭") return "P"
  if (category === "하퍼") return "H"
  if (category === "셔츠") return "S"
  return null
}

// time_minutes + category → ticket 표시명 (참여자 등록 route 와 동일 로직).
function deriveTicket(timeMinutes: number, category: string | null): string {
  if (timeMinutes <= 8) return "무료"
  if (timeMinutes <= 15) return "차3"
  const halfTime = category === "퍼블릭" ? 45 : 30
  const boundaryEnd = halfTime + 10
  if (timeMinutes <= halfTime) return "반티"
  if (timeMinutes <= boundaryEnd) return "반티" // 경계는 UI 재선택; 표시는 반티로.
  return "기본"
}

export type BuildingRoomsResponse = {
  scope: "super_admin" | "own_store"
  current_store_uuid: string
  current_manager_name: string | null
  stores: Array<{
    store_uuid: string
    store_name: string
    floor: number | null
    rooms: Array<{
      room_uuid: string
      room_no: string
      room_name: string
      floor_no: number | null
      is_active: boolean
      session: null | {
        session_id: string
        started_at: string
        manager_name: string | null
        manager_membership_id: string | null
        is_mine: boolean
        customer_name: string | null
        customer_party_size: number
        participants: Array<{
          participant_id: string
          name: string
          category: string | null
          category_letter: "P" | "H" | "S" | null
          ticket: string
          is_external: boolean
          origin_store_uuid: string | null
          origin_store_name: string | null
        }>
        categories: Array<"P" | "H" | "S">
        participant_count: number
      }
    }>
  }>
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role guard — 프로토타입 외부조판은 실장/사장/super_admin 만 의미 있음.
    if (!["owner", "manager"].includes(authContext.role) && !authContext.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "외부조판은 실장/사장/super_admin 만 접근 가능합니다." },
        { status: 403 },
      )
    }

    const isSuper = authContext.is_super_admin === true
    const cacheKey = isSuper
      ? "super:v1"
      : `own:${authContext.store_uuid}:v1`

    const payload = await cached<BuildingRoomsResponse>(
      "building_rooms",
      cacheKey,
      BUILDING_ROOMS_TTL_MS,
      async () => {
        const sb = getServiceClient()

        // 1) 대상 매장 확정
        //    super_admin → 5~8F 전체
        //    others      → 자기 store_uuid 만
        const storesQ = sb
          .from("stores")
          .select("id, store_name, floor")
          .is("deleted_at", null)
        if (isSuper) {
          // 외부조판은 접객 매장 (5~8F) 만. 카페(3F) 는 별개 흐름이라 제외.
          const entertainmentFloors = (BUILDING_FLOORS as readonly number[]).filter(
            (f) => !isCafeFloor(f),
          )
          storesQ.in("floor", entertainmentFloors)
        } else {
          storesQ.eq("id", authContext.store_uuid)
        }
        const { data: storesData, error: storesErr } = await storesQ
        if (storesErr) throw new Error("STORES_QUERY_FAILED")
        const stores = ((storesData as StoreRow[] | null) ?? [])
          .sort((a, b) => {
            const fa = a.floor ?? 999
            const fb = b.floor ?? 999
            if (fa !== fb) return fa - fb
            return a.store_name.localeCompare(b.store_name, "ko")
          })
        const storeIds = stores.map((s) => s.id)
        const storeMap = new Map(stores.map((s) => [s.id, s]))
        if (storeIds.length === 0) {
          return {
            scope: isSuper ? "super_admin" : "own_store",
            current_store_uuid: authContext.store_uuid,
            current_manager_name: null,
            stores: [],
          }
        }

        // 2) 모든 방 + 활성 세션 + 참여자 병렬 fetch
        const [roomsRes, sessionsRes] = await Promise.all([
          sb
            .from("rooms")
            .select("id, store_uuid, room_no, room_name, is_active, floor_no, sort_order")
            .in("store_uuid", storeIds)
            .is("deleted_at", null)
            .order("sort_order", { ascending: true }),
          sb
            .from("room_sessions")
            .select("id, store_uuid, room_uuid, status, started_at, ended_at, manager_name, manager_membership_id, customer_name_snapshot, customer_party_size")
            .in("store_uuid", storeIds)
            .eq("status", "active")
            .is("archived_at", null),
        ])
        if (roomsRes.error) throw new Error("ROOMS_QUERY_FAILED")
        const rooms = (roomsRes.data as RoomRow[] | null) ?? []
        const sessions: SessionRow[] = !sessionsRes.error && sessionsRes.data
          ? (sessionsRes.data as SessionRow[])
          : []

        // 3) 참여자 fetch (활성 세션 only)
        const sessionIds = sessions.map((s) => s.id)
        let participants: ParticipantRow[] = []
        if (sessionIds.length > 0) {
          const { data: pData } = await sb
            .from("session_participants")
            .select("id, session_id, membership_id, external_name, category, time_minutes, status, origin_store_uuid, memo")
            .in("session_id", sessionIds)
            .eq("status", "active")
            .is("deleted_at", null)
            .is("archived_at", null)
          participants = (pData as ParticipantRow[] | null) ?? []
        }

        // 4) 참여자 이름 해석 — membership_id → profiles.full_name
        //    external_name 우선 (별칭), 없으면 profiles.full_name.
        const memIds = Array.from(
          new Set(participants.map((p) => p.membership_id).filter((x): x is string => !!x)),
        )
        const nameByMembership = new Map<string, string>()
        if (memIds.length > 0) {
          const { data: memData } = await sb
            .from("store_memberships")
            .select("id, profile_id, store_uuid")
            .in("id", memIds)
          const memRows = (memData as MembershipRow[] | null) ?? []
          const profileIds = Array.from(new Set(memRows.map((m) => m.profile_id)))
          const profileNameById = new Map<string, string>()
          if (profileIds.length > 0) {
            const { data: profData } = await sb
              .from("profiles")
              .select("id, full_name")
              .in("id", profileIds)
            for (const p of (profData as ProfileRow[] | null) ?? []) {
              profileNameById.set(p.id, p.full_name ?? "")
            }
          }
          for (const m of memRows) {
            nameByMembership.set(m.id, profileNameById.get(m.profile_id) ?? "")
          }
        }

        // 5) 현재 사용자 이름 (manager_membership_id → is_mine 판정용)
        //    is_super_admin 이면 override 된 매장의 실장으로 판단, 원래 매장 사장이면 사장 이름.
        let currentManagerName: string | null = null
        try {
          const { data: myMem } = await sb
            .from("store_memberships")
            .select("profile_id")
            .eq("id", authContext.membership_id)
            .maybeSingle()
          if (myMem?.profile_id) {
            const { data: myProfile } = await sb
              .from("profiles")
              .select("full_name")
              .eq("id", myMem.profile_id)
              .maybeSingle()
            currentManagerName = myProfile?.full_name ?? null
          }
        } catch { /* silent */ }

        // 6) origin_store_uuid → store_name 매핑 (참여자가 타매장 소속인 경우 표시)
        const originStoreIds = Array.from(
          new Set(
            participants
              .map((p) => p.origin_store_uuid)
              .filter((x): x is string => !!x)
              .filter((x) => !storeMap.has(x)),
          ),
        )
        const originStoreNameById = new Map<string, string>()
        if (originStoreIds.length > 0) {
          const { data: originData } = await sb
            .from("stores")
            .select("id, store_name")
            .in("id", originStoreIds)
          for (const s of (originData as StoreRow[] | null) ?? []) {
            originStoreNameById.set(s.id, s.store_name)
          }
        }

        // 7) 조립
        const sessionByRoom = new Map<string, SessionRow>()
        for (const s of sessions) sessionByRoom.set(s.room_uuid, s)

        const participantsBySession = new Map<string, ParticipantRow[]>()
        for (const p of participants) {
          const arr = participantsBySession.get(p.session_id) ?? []
          arr.push(p)
          participantsBySession.set(p.session_id, arr)
        }

        const roomsByStore = new Map<string, RoomRow[]>()
        for (const r of rooms) {
          const arr = roomsByStore.get(r.store_uuid) ?? []
          arr.push(r)
          roomsByStore.set(r.store_uuid, arr)
        }

        const storeBlocks: BuildingRoomsResponse["stores"] = stores.map((s) => {
          const storeRooms = (roomsByStore.get(s.id) ?? []).map((r) => {
            const sess = sessionByRoom.get(r.id) ?? null
            if (!sess) {
              return {
                room_uuid: r.id,
                room_no: r.room_no,
                room_name: r.room_name,
                floor_no: r.floor_no,
                is_active: r.is_active,
                session: null,
              }
            }
            const parts = participantsBySession.get(sess.id) ?? []
            const partDtos = parts.map((p) => {
              const name = p.external_name?.trim()
                || (p.membership_id ? nameByMembership.get(p.membership_id) : null)
                || p.memo
                || "?"
              const cletter = categoryToLetter(p.category)
              const isExternal = !!p.origin_store_uuid && !storeMap.has(p.origin_store_uuid) ? true
                : (p.origin_store_uuid && p.origin_store_uuid !== s.id) ? true
                : false
              const originStoreName = p.origin_store_uuid
                ? (storeMap.get(p.origin_store_uuid)?.store_name ?? originStoreNameById.get(p.origin_store_uuid) ?? null)
                : null
              return {
                participant_id: p.id,
                name,
                category: p.category,
                category_letter: cletter,
                ticket: deriveTicket(p.time_minutes, p.category),
                is_external: isExternal,
                origin_store_uuid: p.origin_store_uuid,
                origin_store_name: originStoreName,
              }
            })
            const catSet = new Set<"P" | "H" | "S">()
            for (const p of partDtos) {
              if (p.category_letter) catSet.add(p.category_letter)
            }
            const isMine = sess.manager_membership_id === authContext.membership_id
            return {
              room_uuid: r.id,
              room_no: r.room_no,
              room_name: r.room_name,
              floor_no: r.floor_no,
              is_active: r.is_active,
              session: {
                session_id: sess.id,
                started_at: sess.started_at,
                manager_name: sess.manager_name,
                manager_membership_id: sess.manager_membership_id,
                is_mine: isMine,
                customer_name: sess.customer_name_snapshot,
                customer_party_size: sess.customer_party_size ?? 0,
                participants: partDtos,
                categories: (["P", "H", "S"] as const).filter((c) => catSet.has(c)),
                participant_count: partDtos.length,
              },
            }
          })
          return {
            store_uuid: s.id,
            store_name: s.store_name,
            floor: s.floor,
            rooms: storeRooms,
          }
        })

        return {
          scope: isSuper ? "super_admin" : "own_store",
          current_store_uuid: authContext.store_uuid,
          current_manager_name: currentManagerName,
          stores: storeBlocks,
        }
      },
    )

    const res = NextResponse.json(payload)
    res.headers.set("Cache-Control", "private, max-age=4, stale-while-revalidate=30")
    return res
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
        { status },
      )
    }
    const msg = error instanceof Error ? error.message : "Unexpected error."
    return NextResponse.json(
      { error: "QUERY_FAILED", message: msg },
      { status: 500 },
    )
  }
}
