import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

/**
 * /api/ble/gateways/[id]
 *
 * PATCH  : 게이트웨이 수정 (display_name, room_uuid, is_active, gateway_type)
 *          gateway_id / gateway_secret 은 변경 불가 (별도 endpoint)
 * DELETE : 게이트웨이 삭제 (hard delete — ble_gateways 는 deleted_at 없음)
 *          관련 ble_ingest_events 는 그대로 보존 (FK SET NULL 정책 가정).
 *
 * 권한: owner only.
 */

export const runtime = "nodejs"

const GATEWAY_TYPES = ["room", "common", "entrance"] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 수정 가능." },
        { status: 403 },
      )
    }

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "id 형식 오류." }, { status: 400 })
    }

    let body: {
      display_name?: string | null
      room_uuid?: string | null
      is_active?: boolean
      gateway_type?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.display_name !== undefined) {
      updateData.display_name = body.display_name?.trim() || null
    }
    if (body.room_uuid !== undefined) {
      if (body.room_uuid === null) {
        updateData.room_uuid = null
      } else if (isValidUUID(body.room_uuid)) {
        updateData.room_uuid = body.room_uuid
      } else {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "room_uuid 형식 오류." },
          { status: 400 },
        )
      }
    }
    if (body.is_active !== undefined) {
      updateData.is_active = !!body.is_active
    }
    if (body.gateway_type !== undefined) {
      if (!(GATEWAY_TYPES as readonly string[]).includes(body.gateway_type)) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "gateway_type 값 오류." },
          { status: 400 },
        )
      }
      updateData.gateway_type = body.gateway_type
    }

    const supabase = getServiceClient()

    // 매장 소속 확인 + room_uuid 변경 시 해당 방이 매장 소속인지 검증.
    if (updateData.room_uuid && typeof updateData.room_uuid === "string") {
      const { data: room } = await supabase
        .from("rooms")
        .select("id")
        .eq("id", updateData.room_uuid)
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

    const { data: updated, error: updErr } = await supabase
      .from("ble_gateways")
      .update(updateData)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .select("id, gateway_id, room_uuid, display_name, gateway_type, is_active, updated_at")
      .single()

    if (updErr || !updated) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: updErr?.message || "수정 실패." },
        { status: 500 },
      )
    }

    void supabase
      .from("audit_events")
      .insert({
        store_uuid: auth.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "ble_gateways",
        entity_id: id,
        action: "ble_gateway_updated",
        after: updateData,
      })
      .then(undefined, () => { /* swallow */ })

    return NextResponse.json({ gateway: updated })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 삭제 가능." },
        { status: 403 },
      )
    }

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabase = getServiceClient()

    // 삭제 전 row 가져오기 (audit 용)
    const { data: existing } = await supabase
      .from("ble_gateways")
      .select("id, gateway_id")
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const { error: delErr } = await supabase
      .from("ble_gateways")
      .delete()
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)

    if (delErr) {
      return NextResponse.json(
        { error: "DELETE_FAILED", message: delErr.message },
        { status: 500 },
      )
    }

    void supabase
      .from("audit_events")
      .insert({
        store_uuid: auth.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "ble_gateways",
        entity_id: id,
        action: "ble_gateway_deleted",
        before: { gateway_id: existing.gateway_id },
      })
      .then(undefined, () => { /* swallow */ })

    return NextResponse.json({ deleted: true, id })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
