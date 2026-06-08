/**
 * 스태프 사전등록 — /api/manager/hostesses/pre-register
 *
 * POST: 실장이 이름+전화로 본인 매장에 사전등록.
 * GET:  본인이 등록한 active 사전등록 목록 (가입 대기 + 가입 완료).
 *
 * 자동 연동: 스태프가 나중에 /signup 으로 가입할 때 전화번호 매칭으로
 *   linked_membership_id / linked_hostess_id 자동 채워짐
 *   (app/api/auth/signup 의 후처리에서 처리).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/** 010-1234-5678 / 010 1234 5678 → 01012345678 */
function normalizePhone(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "")
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager" && auth.role !== "owner") {
      return bad("ROLE_FORBIDDEN", "실장 또는 사장만 사전등록 가능합니다.", 403)
    }

    let body: { name?: string; phone?: string; stage_name?: string; note?: string }
    try {
      body = await request.json()
    } catch {
      return bad("BAD_REQUEST", "Invalid JSON", 400)
    }

    const name = String(body.name ?? "").trim()
    const phone = normalizePhone(String(body.phone ?? ""))
    const stageName = body.stage_name ? String(body.stage_name).trim() : null
    const note = body.note ? String(body.note).trim() : null

    if (!name || name.length > 60) return bad("BAD_REQUEST", "이름은 1~60자.", 400)
    if (phone.length < 9 || phone.length > 15) return bad("BAD_REQUEST", "전화번호는 9~15자리 숫자.", 400)

    const supabase = getServiceClient()

    // 중복 검사
    //   1. 이미 같은 phone 의 활성 사전등록이 본인 매장에 있는지
    //   2. 이미 같은 phone 의 활성 hostess 가 본인 매장에 있는지 (가입 완료된 사람)
    const [preExisting, hostessExisting] = await Promise.all([
      supabase
        .from("hostess_pre_registrations")
        .select("id, name")
        .eq("store_uuid", auth.store_uuid)
        .eq("phone", phone)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("hostesses")
        .select("id, name")
        .eq("store_uuid", auth.store_uuid)
        .eq("phone", phone)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle(),
    ])
    if (preExisting.data) {
      return bad("DUPLICATE_PHONE", `이미 같은 번호로 사전등록된 사람이 있습니다 (${preExisting.data.name}).`, 409)
    }
    if (hostessExisting.data) {
      return bad("DUPLICATE_PHONE", `이미 같은 번호로 가입된 스태프가 있습니다 (${hostessExisting.data.name}).`, 409)
    }

    const { data: row, error } = await supabase
      .from("hostess_pre_registrations")
      .insert({
        store_uuid: auth.store_uuid,
        manager_membership_id: auth.membership_id,
        name,
        phone,
        stage_name: stageName,
        note,
      })
      .select("id, name, phone, stage_name, note, created_at, linked_membership_id")
      .single()

    if (error || !row) {
      // migration 미적용 시 42P01 (relation does not exist) 가능
      if ((error as { code?: string } | null)?.code === "42P01") {
        return bad(
          "MIGRATION_REQUIRED",
          "사전등록 테이블이 아직 적용되지 않았습니다. database/111_hostess_pre_registrations.sql 을 Supabase 에 적용해주세요.",
          503,
        )
      }
      return bad("INSERT_FAILED", error?.message ?? "사전등록에 실패했습니다.", 500)
    }

    return NextResponse.json({ ok: true, pre_registration: row }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager" && auth.role !== "owner") {
      return bad("ROLE_FORBIDDEN", "Access denied.", 403)
    }

    const supabase = getServiceClient()
    const q =
      auth.role === "owner"
        ? // owner: 매장 전체
          supabase
            .from("hostess_pre_registrations")
            .select("id, name, phone, stage_name, note, created_at, linked_membership_id, linked_hostess_id, manager_membership_id")
            .eq("store_uuid", auth.store_uuid)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
        : // manager: 본인 등록만
          supabase
            .from("hostess_pre_registrations")
            .select("id, name, phone, stage_name, note, created_at, linked_membership_id, linked_hostess_id, manager_membership_id")
            .eq("store_uuid", auth.store_uuid)
            .eq("manager_membership_id", auth.membership_id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })

    const { data, error } = await q
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        // migration 미적용 — 빈 배열로 graceful fallback
        return NextResponse.json({ pre_registrations: [], migration_required: true })
      }
      return bad("QUERY_FAILED", error.message, 500)
    }
    return NextResponse.json({ pre_registrations: data ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
