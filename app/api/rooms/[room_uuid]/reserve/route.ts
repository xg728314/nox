import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { invalidate } from "@/lib/cache/inMemoryTtl"

// R30-A (2026-07-24): 방 예약. 실장이 아가씨 배정 전 빈방을 자기 몫으로 잡음.
//   - POST   /api/rooms/[room_uuid]/reserve   → 예약 (본인 명의)
//   - DELETE /api/rooms/[room_uuid]/reserve   → 예약 해제 (본인 예약만)
//
// 규칙:
//   - 활성 세션이 있는 방은 예약 불가.
//   - 다른 실장이 이미 예약한 방은 재예약 불가 (그 실장이 해제해야 함).
//   - super_admin 은 예외적으로 다른 실장 예약도 해제 가능 (실무: 잠긴 방 개방).
//   - store_uuid scope: 자기 매장 방만 예약 가능. super_admin 은 override 매장.
//   - Audit: rooms.reserved / rooms.reserve_cleared.

type RoomRow = {
  id: string
  store_uuid: string
  reserved_by_membership_id: string | null
  reserved_by_name: string | null
  reserved_at: string | null
  deleted_at: string | null
}

async function loadCurrentManagerName(sb: ReturnType<typeof getServiceClient>, membershipId: string): Promise<string | null> {
  try {
    const { data: mem } = await sb
      .from("store_memberships")
      .select("profile_id")
      .eq("id", membershipId)
      .maybeSingle()
    if (!mem?.profile_id) return null
    const { data: profile } = await sb
      .from("profiles")
      .select("full_name")
      .eq("id", mem.profile_id)
      .maybeSingle()
    return profile?.full_name ?? null
  } catch {
    return null
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ room_uuid: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { room_uuid } = await params

    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "예약은 실장/사장/super_admin 만 가능합니다." },
        { status: 403 },
      )
    }

    const sb = getServiceClient()

    // 방 조회
    const { data: roomData, error: roomErr } = await sb
      .from("rooms")
      .select("id, store_uuid, reserved_by_membership_id, reserved_by_name, reserved_at, deleted_at")
      .eq("id", room_uuid)
      .maybeSingle()
    if (roomErr) {
      return NextResponse.json({ error: "QUERY_FAILED", message: "방 조회 실패." }, { status: 500 })
    }
    const room = roomData as RoomRow | null
    if (!room || room.deleted_at) {
      return NextResponse.json({ error: "NOT_FOUND", message: "방을 찾을 수 없습니다." }, { status: 404 })
    }

    // Scope: 자기 매장 or super_admin.
    if (room.store_uuid !== auth.store_uuid && !auth.is_super_admin) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN", message: "타 매장 방은 예약할 수 없습니다." }, { status: 403 })
    }

    // 활성 세션 확인
    const { data: activeSess } = await sb
      .from("room_sessions")
      .select("id")
      .eq("room_uuid", room_uuid)
      .eq("status", "active")
      .is("archived_at", null)
      .limit(1)
    if (activeSess && activeSess.length > 0) {
      return NextResponse.json(
        { error: "ROOM_ACTIVE", message: "사용 중인 방은 예약할 수 없습니다." },
        { status: 409 },
      )
    }

    // 이미 다른 실장 예약?
    if (room.reserved_by_membership_id && room.reserved_by_membership_id !== auth.membership_id) {
      return NextResponse.json(
        {
          error: "ALREADY_RESERVED",
          message: `이미 ${room.reserved_by_name ?? "다른 실장"}이(가) 예약했습니다.`,
          reserved_by_name: room.reserved_by_name,
          reserved_at: room.reserved_at,
        },
        { status: 409 },
      )
    }

    // 예약자 이름 스냅샷
    const managerName = await loadCurrentManagerName(sb, auth.membership_id)

    const nowIso = new Date().toISOString()
    const { data: updated, error: updErr } = await sb
      .from("rooms")
      .update({
        reserved_by_membership_id: auth.membership_id,
        reserved_by_name: managerName,
        reserved_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", room_uuid)
      .select("id, reserved_by_membership_id, reserved_by_name, reserved_at")
      .single()
    if (updErr || !updated) {
      return NextResponse.json(
        { error: "RESERVE_FAILED", message: updErr?.message ?? "예약 실패." },
        { status: 500 },
      )
    }

    // Audit
    await sb.from("audit_events").insert({
      store_uuid: room.store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: auth.role,
      entity_table: "rooms",
      entity_id: room_uuid,
      action: "room_reserved",
      after: {
        reserved_by_name: managerName,
        reserved_at: nowIso,
      },
    })

    // 캐시 무효화 (building_rooms · 본 매장 rooms)
    invalidate("building_rooms")
    invalidate(`rooms`)

    return NextResponse.json({
      ok: true,
      room: updated,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ room_uuid: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { room_uuid } = await params

    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "예약 해제는 실장/사장/super_admin 만 가능합니다." },
        { status: 403 },
      )
    }

    const sb = getServiceClient()
    const { data: roomData } = await sb
      .from("rooms")
      .select("id, store_uuid, reserved_by_membership_id, reserved_by_name, reserved_at, deleted_at")
      .eq("id", room_uuid)
      .maybeSingle()
    const room = roomData as RoomRow | null
    if (!room || room.deleted_at) {
      return NextResponse.json({ error: "NOT_FOUND", message: "방을 찾을 수 없습니다." }, { status: 404 })
    }
    if (room.store_uuid !== auth.store_uuid && !auth.is_super_admin) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN", message: "타 매장 방 예약은 해제할 수 없습니다." }, { status: 403 })
    }
    if (!room.reserved_by_membership_id) {
      return NextResponse.json({ ok: true, note: "already_unreserved" })
    }
    // 본인 예약 or super_admin 만.
    if (room.reserved_by_membership_id !== auth.membership_id && !auth.is_super_admin) {
      return NextResponse.json(
        { error: "NOT_OWNER", message: "본인이 예약한 방만 해제할 수 있습니다." },
        { status: 403 },
      )
    }

    const nowIso = new Date().toISOString()
    const { error: updErr } = await sb
      .from("rooms")
      .update({
        reserved_by_membership_id: null,
        reserved_by_name: null,
        reserved_at: null,
        updated_at: nowIso,
      })
      .eq("id", room_uuid)
    if (updErr) {
      return NextResponse.json({ error: "CLEAR_FAILED", message: updErr.message }, { status: 500 })
    }

    await sb.from("audit_events").insert({
      store_uuid: room.store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: auth.role,
      entity_table: "rooms",
      entity_id: room_uuid,
      action: "room_reserve_cleared",
      before: {
        reserved_by_name: room.reserved_by_name,
        reserved_at: room.reserved_at,
      },
    })

    invalidate("building_rooms")
    invalidate(`rooms`)

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
