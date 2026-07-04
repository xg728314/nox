/**
 * GET /api/rooms/building-map
 *
 * 5~8층 전체 방 지도 데이터.
 *   - 각 층/매장별 방 목록
 *   - 활성 세션 정보 (있으면)
 *   - 세션 참여자 이름 + 남은 분 (임박 하이라이트)
 *
 * 권한: 로그인 사용자 누구나.
 *
 * R-building-map (2026-06-28).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const supabase = getServiceClient()

    // 1. 5~8층 매장 + 층 정보
    const { data: stores } = await supabase
      .from("stores")
      .select("id, store_name, floor")
      .in("floor", [5, 6, 7, 8])
      .is("deleted_at", null)
      .order("floor")
      .order("store_name")
    type Store = { id: string; store_name: string; floor: number }
    const storeRows = (stores ?? []) as Store[]

    // 2. 각 매장의 방들
    const storeIds = storeRows.map((s) => s.id)
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_no, store_uuid")
      .in("store_uuid", storeIds)
      .is("deleted_at", null)
      .order("room_no")
    type Room = { id: string; room_no: string; store_uuid: string }
    const roomRows = (rooms ?? []) as Room[]

    // 3. active session (방별 최대 1개)
    const { data: sess } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, store_uuid, started_at, manager_membership_id")
      .in("store_uuid", storeIds)
      .eq("status", "active")
      .is("deleted_at", null)
    type Sess = {
      id: string
      room_uuid: string
      store_uuid: string
      started_at: string
      manager_membership_id: string | null
    }
    const sessRows = (sess ?? []) as Sess[]
    const sessByRoom = new Map<string, Sess>()
    for (const s of sessRows) sessByRoom.set(s.room_uuid, s)

    // 4. 참여자 (active) — 세션별 이름/시간
    const sessIds = sessRows.map((s) => s.id)
    const partsBySession = new Map<
      string,
      Array<{
        name: string
        category: string | null
        time_minutes: number | null
        entered_at: string
        remaining_min: number | null
      }>
    >()
    if (sessIds.length > 0) {
      const { data: parts } = await supabase
        .from("session_participants")
        .select(
          "session_id, membership_id, category, time_minutes, entered_at, hostesses!inner(name)",
        )
        .in("session_id", sessIds)
        .eq("status", "active")
        .is("deleted_at", null)
      type P = {
        session_id: string
        membership_id: string
        category: string | null
        time_minutes: number | null
        entered_at: string
        hostesses: { name: string } | { name: string }[] | null
      }
      const now = Date.now()
      for (const p of ((parts ?? []) as P[])) {
        const hObj = Array.isArray(p.hostesses) ? p.hostesses[0] : p.hostesses
        const name = hObj?.name ?? "?"
        let remain: number | null = null
        if (p.time_minutes != null) {
          const endMs = new Date(p.entered_at).getTime() + p.time_minutes * 60_000
          remain = Math.floor((endMs - now) / 60_000)
        }
        const arr = partsBySession.get(p.session_id) ?? []
        arr.push({
          name,
          category: p.category,
          time_minutes: p.time_minutes,
          entered_at: p.entered_at,
          remaining_min: remain,
        })
        partsBySession.set(p.session_id, arr)
      }
    }

    // 5. 응답 조합 — 층 → 매장 → 방
    const byFloor = new Map<
      number,
      Array<{
        store_uuid: string
        store_name: string
        rooms: Array<{
          room_uuid: string
          room_no: string
          status: "active" | "idle"
          session_id?: string
          remaining_min?: number | null
          category?: string | null
          participant_names?: string[]
        }>
      }>
    >()
    for (const s of storeRows) {
      if (!byFloor.has(s.floor)) byFloor.set(s.floor, [])
      byFloor.get(s.floor)!.push({
        store_uuid: s.id,
        store_name: s.store_name,
        rooms: [],
      })
    }
    for (const r of roomRows) {
      const store = storeRows.find((s) => s.id === r.store_uuid)
      if (!store) continue
      const storeSlot = byFloor.get(store.floor)?.find((x) => x.store_uuid === store.id)
      if (!storeSlot) continue
      const s = sessByRoom.get(r.id)
      const roomData: {
        room_uuid: string
        room_no: string
        status: "active" | "idle"
        session_id?: string
        remaining_min?: number | null
        category?: string | null
        participant_names?: string[]
      } = {
        room_uuid: r.id,
        room_no: r.room_no,
        status: s ? "active" : "idle",
      }
      if (s) {
        roomData.session_id = s.id
        const parts = partsBySession.get(s.id) ?? []
        const remains = parts
          .map((p) => p.remaining_min)
          .filter((v): v is number => typeof v === "number")
        roomData.remaining_min =
          remains.length > 0 ? Math.min(...remains) : null
        roomData.category = parts[0]?.category ?? null
        roomData.participant_names = parts.map((p) => p.name)
      }
      storeSlot.rooms.push(roomData)
    }

    const floors = [...byFloor.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, stores]) => ({ floor, stores }))

    return NextResponse.json({ floors })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}
