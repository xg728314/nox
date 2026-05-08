import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

/**
 * /api/ble/tags/[id]
 *
 * PATCH  : 태그 수정 (membership_id 매핑, 라벨, 활성 토글).
 *          minor 변경 불가 (펌웨어 고정값) — 변경 시 새 태그 등록.
 * DELETE : 태그 삭제 (hard delete).
 *
 * 권한: owner only.
 */

export const runtime = "nodejs"

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
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    let body: {
      membership_id?: string | null
      tag_label?: string | null
      is_active?: boolean
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.membership_id !== undefined) {
      if (body.membership_id === null) {
        updateData.membership_id = null
      } else if (isValidUUID(body.membership_id)) {
        updateData.membership_id = body.membership_id
      } else {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "membership_id 형식 오류." },
          { status: 400 },
        )
      }
    }
    if (body.tag_label !== undefined) {
      updateData.tag_label = body.tag_label?.trim() || null
    }
    if (body.is_active !== undefined) {
      updateData.is_active = !!body.is_active
    }

    const supabase = getServiceClient()

    // membership_id 변경 시 매장 소속 + approved 검증
    if (updateData.membership_id && typeof updateData.membership_id === "string") {
      const { data: mem } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("id", updateData.membership_id)
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "approved")
        .is("deleted_at", null)
        .maybeSingle()
      if (!mem) {
        return NextResponse.json(
          { error: "MEMBERSHIP_NOT_FOUND", message: "매핑할 직원을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("ble_tags")
      .update(updateData)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .select("id, minor, membership_id, tag_label, is_active, updated_at")
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
        entity_table: "ble_tags",
        entity_id: id,
        action: "ble_tag_updated",
        after: updateData,
      })
      .then(undefined, () => { /* swallow */ })

    return NextResponse.json({ tag: updated })
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

    const { data: existing } = await supabase
      .from("ble_tags")
      .select("id, minor")
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const { error: delErr } = await supabase
      .from("ble_tags")
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
        entity_table: "ble_tags",
        entity_id: id,
        action: "ble_tag_deleted",
        before: { minor: existing.minor },
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
