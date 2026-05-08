import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/ble/tags/discovered
 *
 * 게이트웨이가 최근 N분 안 감지한 미등록 태그 목록.
 *
 * 동작:
 *   1. ble_ingest_events 에서 최근 10분 동안의 minor 별 last_seen 집계.
 *   2. ble_tags 테이블에 등록된 minor 와 비교 → 미등록만 반환.
 *   3. 어느 게이트웨이/방에서 감지됐는지, RSSI (신호 세기) 평균 포함.
 *
 * 사용 시나리오:
 *   점주가 알리바바 태그 박스에서 1개 꺼내 게이트웨이 근처에 두면 → 1초 내
 *   감지 → 이 endpoint 가 "minor=103" 반환 → UI 에서 "🆕 새 태그 발견" 표시.
 *
 * 권한: owner only.
 */

export const runtime = "nodejs"

const DISCOVERY_WINDOW_MIN = 10  // 최근 10분 안 신호 본 것만

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 미등록 태그 감지 가능." },
        { status: 403 },
      )
    }
    const supabase = getServiceClient()

    const sinceIso = new Date(Date.now() - DISCOVERY_WINDOW_MIN * 60 * 1000).toISOString()

    // 최근 10분 내 모든 ingest 이벤트 + 등록된 태그 minor 동시 fetch.
    const [eventsRes, tagsRes, gatewaysRes, roomsRes] = await Promise.all([
      supabase
        .from("ble_ingest_events")
        .select("beacon_minor, gateway_id, room_uuid, rssi, observed_at, received_at")
        .eq("store_uuid", auth.store_uuid)
        .gte("received_at", sinceIso)
        .order("received_at", { ascending: false })
        .limit(2000),
      supabase
        .from("ble_tags")
        .select("minor")
        .eq("store_uuid", auth.store_uuid),
      supabase
        .from("ble_gateways")
        .select("gateway_id, display_name, room_uuid")
        .eq("store_uuid", auth.store_uuid),
      supabase
        .from("rooms")
        .select("id, room_no, room_name")
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
    ])

    if (eventsRes.error) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: eventsRes.error.message },
        { status: 500 },
      )
    }

    // 등록된 minor set
    const registered = new Set<number>(
      ((tagsRes.data ?? []) as Array<{ minor: number }>).map((t) => t.minor),
    )

    // 게이트웨이 / 방 lookup
    const gwMap = new Map<string, { display_name: string | null; room_uuid: string | null }>()
    for (const g of (gatewaysRes.data ?? []) as Array<{
      gateway_id: string
      display_name: string | null
      room_uuid: string | null
    }>) {
      gwMap.set(g.gateway_id, { display_name: g.display_name, room_uuid: g.room_uuid })
    }
    const roomMap = new Map<string, { room_no: string; room_name: string | null }>()
    for (const r of (roomsRes.data ?? []) as Array<{
      id: string
      room_no: string
      room_name: string | null
    }>) {
      roomMap.set(r.id, { room_no: r.room_no, room_name: r.room_name })
    }

    // minor 별 집계
    type Discovery = {
      minor: number
      first_seen_at: string
      last_seen_at: string
      detect_count: number
      avg_rssi: number | null
      last_gateway_id: string
      last_gateway_label: string | null
      last_room_label: string | null
    }
    const byMinor = new Map<number, {
      first: string
      last: string
      count: number
      rssiSum: number
      rssiCount: number
      lastGateway: string
      lastRoomUuid: string | null
    }>()

    for (const ev of (eventsRes.data ?? []) as Array<{
      beacon_minor: number
      gateway_id: string
      room_uuid: string | null
      rssi: number | null
      observed_at: string
      received_at: string
    }>) {
      if (registered.has(ev.beacon_minor)) continue  // 등록된 건 skip

      const existing = byMinor.get(ev.beacon_minor)
      const ts = ev.received_at
      if (!existing) {
        byMinor.set(ev.beacon_minor, {
          first: ts,
          last: ts,
          count: 1,
          rssiSum: typeof ev.rssi === "number" ? ev.rssi : 0,
          rssiCount: typeof ev.rssi === "number" ? 1 : 0,
          lastGateway: ev.gateway_id,
          lastRoomUuid: ev.room_uuid,
        })
      } else {
        existing.count++
        if (typeof ev.rssi === "number") {
          existing.rssiSum += ev.rssi
          existing.rssiCount++
        }
        // 더 최근 (eventsRes 가 desc 정렬이라 첫 행이 최근)
        if (ts > existing.last) {
          existing.last = ts
          existing.lastGateway = ev.gateway_id
          existing.lastRoomUuid = ev.room_uuid
        }
        if (ts < existing.first) existing.first = ts
      }
    }

    const discoveries: Discovery[] = [...byMinor.entries()].map(([minor, agg]) => {
      const gw = gwMap.get(agg.lastGateway) ?? null
      const roomUuid = agg.lastRoomUuid ?? gw?.room_uuid ?? null
      const room = roomUuid ? roomMap.get(roomUuid) ?? null : null
      return {
        minor,
        first_seen_at: agg.first,
        last_seen_at: agg.last,
        detect_count: agg.count,
        avg_rssi: agg.rssiCount > 0 ? Math.round(agg.rssiSum / agg.rssiCount) : null,
        last_gateway_id: agg.lastGateway,
        last_gateway_label: gw?.display_name ?? null,
        last_room_label: room ? `${room.room_no}번방${room.room_name ? ` (${room.room_name})` : ""}` : null,
      }
    })

    // 신호 세기 (RSSI) 강한 순 → 점주가 가까이 둔 태그가 위에.
    discoveries.sort((a, b) => (b.avg_rssi ?? -200) - (a.avg_rssi ?? -200))

    return NextResponse.json({
      store_uuid: auth.store_uuid,
      window_minutes: DISCOVERY_WINDOW_MIN,
      discovered: discoveries,
      total: discoveries.length,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
