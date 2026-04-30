import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { defaultRoomName } from "@/lib/rooms/formatRoomLabel"
import { getRooms } from "@/lib/server/queries/rooms"
import { cached } from "@/lib/cache/inMemoryTtl"

// R29-perf: 380명 동시 사용 시 매장당 분당 수백 회 호출됨.
//   process-local 3초 TTL 캐시 → 부하 70% 감소.
//   카운터 화면에 5초 폴링 가정. 3초 TTL 이면 한 폴링 사이클 동안 1번만 DB.
const ROOMS_TTL_MS = 3000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    try {
      const data = await cached(
        "rooms",
        `${authContext.store_uuid}:${authContext.role}`,
        ROOMS_TTL_MS,
        () => getRooms(authContext),
      )
      const res = NextResponse.json(data)
      // 클라이언트도 1초 stale-while-revalidate 가능
      res.headers.set("Cache-Control", "private, max-age=1, stale-while-revalidate=2")
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to query rooms."
      return NextResponse.json(
        { error: "QUERY_FAILED", message: msg },
        { status: 500 }
      )
    }
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

/**
 * POST /api/rooms — 새 방 추가 (다음 번호 자동 생성)
 */
export async function POST(request: Request) {
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
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Find the highest room_no to determine next number
    const { data: existing } = await supabase
      .from("rooms")
      .select("room_no, sort_order")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)

    const maxSort = existing?.[0]?.sort_order ?? 0
    const nextNum = maxSort + 1
    const roomNo = String(nextNum)
    const roomName = defaultRoomName(nextNum)

    // 2026-04-30: store.floor 에서 floor_no 자동 채움. 이전에는 NULL 로 들어가
    //   scopeResolver / 층별 리포트 / BLE 모니터가 6/7/8층 매장 데이터를
    //   누락. 신규 매장 14개 × 약 5방 = 70+ rooms 가 floor_no NULL 상태였음.
    //   본 라운드 SQL 로 전체 backfill 했고, 향후 추가 방도 자동 정상화되도록
    //   여기서 store.floor 를 lookup 해서 박는다.
    const { data: storeRow } = await supabase
      .from("stores")
      .select("floor")
      .eq("id", authContext.store_uuid)
      .maybeSingle()
    const storeFloor = (storeRow as { floor?: number } | null)?.floor ?? null
    const floorNo = (typeof storeFloor === "number" && storeFloor >= 5 && storeFloor <= 8)
      ? storeFloor : null

    const { data: room, error: insertError } = await supabase
      .from("rooms")
      .insert({
        store_uuid: authContext.store_uuid,
        room_no: roomNo,
        room_name: roomName,
        sort_order: nextNum,
        is_active: true,
        floor_no: floorNo,
      })
      .select("id, room_no, room_name, is_active, sort_order, floor_no")
      .single()

    if (insertError || !room) {
      console.error("[rooms POST] insert failed:", insertError?.message)
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "방 생성에 실패했습니다." },
        { status: 500 }
      )
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "rooms",
      entity_id: room.id,
      action: "room_created",
      after: { room_no: roomNo, room_name: roomName, sort_order: nextNum },
    })

    return NextResponse.json({ room }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
