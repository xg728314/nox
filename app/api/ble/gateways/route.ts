import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"
import { randomBytes } from "node:crypto"

/**
 * /api/ble/gateways
 *
 * 매장 BLE 게이트웨이 관리 (owner 전용).
 *
 * GET  : 매장의 모든 게이트웨이 목록 (gateway_secret 마스킹).
 * POST : 새 게이트웨이 등록. gateway_secret 자동 생성 후 1회 평문 응답.
 *        (이후 GET 에서는 마스킹되어 보이지 않음 — 분실 시 regenerate)
 *
 * 권한: owner only. manager 이하 차단.
 */

export const runtime = "nodejs"

const GATEWAY_TYPES = ["room", "common", "entrance"] as const
type GatewayType = (typeof GATEWAY_TYPES)[number]

function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}

function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return "********"
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 BLE 게이트웨이를 관리할 수 있습니다." },
        { status: 403 },
      )
    }
    const supabase = getServiceClient()

    // gateways + 마지막 통신 시각 (ble_ingest_events) 동시 fetch.
    const [gwRes, eventsRes, roomsRes] = await Promise.all([
      supabase
        .from("ble_gateways")
        .select("id, gateway_id, room_uuid, display_name, gateway_type, is_active, gateway_secret, created_at, updated_at")
        .eq("store_uuid", auth.store_uuid)
        .order("created_at", { ascending: false }),
      // 매장의 모든 게이트웨이 마지막 통신 시각 — 30초 안에 통신 있으면 "online".
      supabase
        .from("ble_ingest_events")
        .select("gateway_id, received_at")
        .eq("store_uuid", auth.store_uuid)
        .gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("received_at", { ascending: false }),
      supabase
        .from("rooms")
        .select("id, room_no, room_name")
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
    ])

    if (gwRes.error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: gwRes.error.message }, { status: 500 })
    }

    const lastSeenMap = new Map<string, string>()
    for (const ev of (eventsRes.data ?? []) as Array<{ gateway_id: string; received_at: string }>) {
      if (!lastSeenMap.has(ev.gateway_id)) {
        lastSeenMap.set(ev.gateway_id, ev.received_at)
      }
    }

    const roomMap = new Map<string, { room_no: string; room_name: string | null }>()
    for (const r of (roomsRes.data ?? []) as Array<{ id: string; room_no: string; room_name: string | null }>) {
      roomMap.set(r.id, { room_no: r.room_no, room_name: r.room_name })
    }

    const gateways = (gwRes.data ?? []).map((g: {
      id: string
      gateway_id: string
      room_uuid: string | null
      display_name: string | null
      gateway_type: string
      is_active: boolean
      gateway_secret: string
      created_at: string
      updated_at: string
    }) => {
      const lastSeen = lastSeenMap.get(g.gateway_id) ?? null
      const onlineThreshold = 5 * 60 * 1000  // 5분 이내면 online
      const isOnline = lastSeen ? Date.now() - new Date(lastSeen).getTime() < onlineThreshold : false
      const room = g.room_uuid ? roomMap.get(g.room_uuid) ?? null : null
      return {
        id: g.id,
        gateway_id: g.gateway_id,
        room_uuid: g.room_uuid,
        room_label: room ? `${room.room_no}번방${room.room_name ? ` (${room.room_name})` : ""}` : null,
        display_name: g.display_name,
        gateway_type: g.gateway_type,
        is_active: g.is_active,
        secret_preview: maskSecret(g.gateway_secret),
        last_seen_at: lastSeen,
        is_online: isOnline,
        created_at: g.created_at,
      }
    })

    return NextResponse.json({ store_uuid: auth.store_uuid, gateways })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 게이트웨이를 등록할 수 있습니다." },
        { status: 403 },
      )
    }

    let body: {
      gateway_id?: string
      room_uuid?: string | null
      display_name?: string | null
      gateway_type?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 })
    }

    const gatewayId = body.gateway_id?.trim()
    if (!gatewayId || gatewayId.length < 3 || gatewayId.length > 64) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "gateway_id 는 3-64자 필수." },
        { status: 400 },
      )
    }
    if (!/^[A-Za-z0-9_-]+$/.test(gatewayId)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "gateway_id 는 영문/숫자/-/_ 만 허용." },
        { status: 400 },
      )
    }

    const gatewayType = (body.gateway_type ?? "room") as GatewayType
    if (!GATEWAY_TYPES.includes(gatewayType)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `gateway_type 은 ${GATEWAY_TYPES.join(", ")} 중 하나.` },
        { status: 400 },
      )
    }

    const roomUuid = body.room_uuid && isValidUUID(body.room_uuid) ? body.room_uuid : null

    const supabase = getServiceClient()

    // gateway_id 매장 내 중복 확인
    const { data: existing } = await supabase
      .from("ble_gateways")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("gateway_id", gatewayId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: "DUPLICATE_GATEWAY_ID", message: "이미 등록된 gateway_id 입니다." },
        { status: 409 },
      )
    }

    // room_uuid 가 있으면 해당 매장 소속인지 검증
    if (roomUuid) {
      const { data: room } = await supabase
        .from("rooms")
        .select("id")
        .eq("id", roomUuid)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!room) {
        return NextResponse.json(
          { error: "ROOM_NOT_FOUND", message: "방을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
    }

    const secret = generateSecret()

    const { data: created, error: insertErr } = await supabase
      .from("ble_gateways")
      .insert({
        store_uuid: auth.store_uuid,
        gateway_id: gatewayId,
        gateway_secret: secret,
        room_uuid: roomUuid,
        display_name: body.display_name?.trim() || null,
        gateway_type: gatewayType,
        is_active: true,
      })
      .select("id, gateway_id, gateway_secret, room_uuid, display_name, gateway_type, is_active, created_at")
      .single()

    if (insertErr || !created) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: insertErr?.message || "등록 실패." },
        { status: 500 },
      )
    }

    // audit (background)
    void supabase
      .from("audit_events")
      .insert({
        store_uuid: auth.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "ble_gateways",
        entity_id: created.id,
        action: "ble_gateway_registered",
        after: {
          gateway_id: gatewayId,
          gateway_type: gatewayType,
          room_uuid: roomUuid,
        },
      })
      .then(undefined, () => { /* swallow */ })

    // gateway_secret 은 응답에 1회만 평문 노출 — 점주가 펌웨어에 입력 후 다시 못 봄.
    return NextResponse.json(
      {
        gateway: {
          id: created.id,
          gateway_id: created.gateway_id,
          gateway_secret: created.gateway_secret,  // 평문 1회 노출
          room_uuid: created.room_uuid,
          display_name: created.display_name,
          gateway_type: created.gateway_type,
          is_active: created.is_active,
          created_at: created.created_at,
        },
        warning: "gateway_secret 은 이번 1회만 표시됩니다. 게이트웨이 펌웨어 설정에 입력하고 안전하게 보관하세요. 분실 시 재발급 (regenerate) 가능.",
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
