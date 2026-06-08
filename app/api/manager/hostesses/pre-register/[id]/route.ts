/**
 * 사전등록 취소 — DELETE /api/manager/hostesses/pre-register/[id]
 *
 * 실장이 본인이 사전등록한 row 만 soft-delete.
 * owner 는 매장 전체 사전등록 삭제 가능.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager" && auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Access denied." }, { status: 403 })
    }

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid id" }, { status: 400 })
    }

    const supabase = getServiceClient()
    const query = supabase
      .from("hostess_pre_registrations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)

    // manager 는 본인 row 만 삭제 가능
    const final = auth.role === "manager"
      ? query.eq("manager_membership_id", auth.membership_id)
      : query

    const { data, error } = await final.select("id").maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ ok: true, migration_required: true })
      }
      return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "NOT_FOUND", message: "사전등록을 찾을 수 없거나 권한이 없습니다." }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
