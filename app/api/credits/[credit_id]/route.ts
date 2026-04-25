import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { auditOr500 } from "@/lib/audit/logEvent"
import { archivedAtFilter } from "@/lib/session/archivedFilter"

/**
 * GET   /api/credits/[credit_id] — 외상 상세 조회
 * PATCH /api/credits/[credit_id] — 상태 변경 (pending → collected | cancelled)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ credit_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { credit_id } = await params
    if (!credit_id || !isValidUUID(credit_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "credit_id must be a valid UUID." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 2026-04-25: archived 된 외상은 상세 조회에서도 숨김.
    const applyArchivedNull = await archivedAtFilter(supabase, "credits")
    const { data: credit, error: queryError } = await applyArchivedNull(
      supabase
        .from("credits")
        .select("*")
        .eq("id", credit_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
    ).maybeSingle()

    if (queryError || !credit) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Credit not found." },
        { status: 404 }
      )
    }

    // 실장은 자기 담당만
    if (authContext.role === "manager" && credit.manager_membership_id !== authContext.membership_id) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "이 외상은 담당이 아닙니다." },
        { status: 403 }
      )
    }

    // 방이름, 실장이름 — ROUND-A: rooms 에 store_uuid + deleted_at 가드 추가.
    //   이전엔 cross-store 룸 이름 누출 가능성 있었음. managers 는 이미
    //   store_uuid 조건 있으나 deleted_at 만 보강.
    const { data: room } = await supabase
      .from("rooms")
      .select("room_name")
      .eq("id", credit.room_uuid)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const { data: manager } = await supabase
      .from("managers")
      .select("name")
      .eq("membership_id", credit.manager_membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    return NextResponse.json({
      ...credit,
      room_name: room?.room_name || null,
      manager_name: manager?.name || null,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 : error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 : error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 : error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ credit_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { credit_id } = await params
    if (!credit_id || !isValidUUID(credit_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "credit_id must be a valid UUID." },
        { status: 400 }
      )
    }

    let body: { status?: string; memo?: string; linked_account_id?: string | null }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const newStatus = body.status
    if (!newStatus || !["collected", "cancelled"].includes(newStatus)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "status must be 'collected' or 'cancelled'." },
        { status: 400 }
      )
    }

    // linked_account_id is only meaningful on collect. Validated below after
    // Supabase client construction.
    if (body.linked_account_id !== undefined && body.linked_account_id !== null) {
      if (!isValidUUID(body.linked_account_id)) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "linked_account_id must be a valid UUID." },
          { status: 400 }
        )
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 기존 외상 조회
    const { data: credit, error: queryError } = await supabase
      .from("credits")
      .select("id, status, manager_membership_id, session_id")
      .eq("id", credit_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (queryError || !credit) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Credit not found." },
        { status: 404 }
      )
    }

    // 실장은 자기 담당만
    if (authContext.role === "manager" && credit.manager_membership_id !== authContext.membership_id) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "이 외상은 담당이 아닙니다." },
        { status: 403 }
      )
    }

    if (credit.status !== "pending") {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: `이미 ${credit.status === "collected" ? "회수" : "취소"}된 외상입니다.` },
        { status: 409 }
      )
    }

    // Structured linkage validation — the linked bank account must belong to
    // the caller's own membership (self-scope). Cross-membership or cross-store
    // account linkage is rejected at the server, not at the UI layer.
    if (body.linked_account_id) {
      const { data: acc } = await supabase
        .from("membership_bank_accounts")
        .select("id")
        .eq("id", body.linked_account_id)
        .eq("membership_id", authContext.membership_id)
        .eq("store_uuid", authContext.store_uuid)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle()
      if (!acc) {
        return NextResponse.json(
          { error: "ACCOUNT_NOT_FOUND", message: "선택한 계좌를 찾을 수 없거나 사용할 수 없습니다." },
          { status: 404 }
        )
      }
    }

    // UPDATE — status/collected_at/collected_by + linked_account_id go into
    // first-class columns. memo stays as free-text (no tag append).
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    }

    if (newStatus === "collected") {
      updateData.collected_at = new Date().toISOString()
      updateData.collected_by = authContext.user_id
      // Only persist the link on collect. Cancel keeps whatever was set
      // (or null) and does not accept a new link.
      if (body.linked_account_id !== undefined) {
        updateData.linked_account_id = body.linked_account_id
      }
    }

    if (body.memo !== undefined) {
      updateData.memo = body.memo?.trim() || null
    }

    // STEP-003: atomic status-transition guard. Two concurrent PATCH calls
    // can both pass the read-time `credit.status !== "pending"` check above
    // (line 176). The `.eq("status", "pending")` filter here ensures only one
    // transitions the row; the loser receives 0 rows affected and a 409
    // instead of double-writing collected_at / collected_by / audit entries.
    //
    // 2026-04-25 hotfix: migration 025 미적용 DB 에서는 linked_account_id
    //   컬럼 자체가 없음. select 절에 포함하면 42703 으로 전체 UPDATE 실패.
    //   updateData 에 linked_account_id 가 들어있으면 먼저 제거 시도, 그래도
    //   select 가 실패하면 축약된 select 로 재시도.
    const BASE_SELECT = "id, status, amount, customer_name, collected_at, collected_by, updated_at"
    const FULL_SELECT = `${BASE_SELECT}, linked_account_id`

    async function runUpdate(selectCols: string, payload: Record<string, unknown>) {
      return await supabase
        .from("credits")
        .update(payload)
        .eq("id", credit_id)
        .eq("store_uuid", authContext.store_uuid)
        .eq("status", "pending")
        .select(selectCols)
        .maybeSingle()
    }

    let { data: updated, error: updateError } = await runUpdate(FULL_SELECT, updateData)
    if (updateError && updateError.code === "42703") {
      console.warn(
        "[credits PATCH] linked_account_id column missing — migration 025 미적용. 필드 제외 후 재시도.",
      )
      // linked_account_id 를 업데이트에서도 제거 (컬럼이 없으니 쓸 수 없음)
      const safePayload = { ...updateData }
      delete safePayload.linked_account_id
      const retry = await runUpdate(BASE_SELECT, safePayload)
      updated = retry.data
      updateError = retry.error
    }

    if (updateError) {
      console.error("[credits PATCH] updateError:", updateError)
      return NextResponse.json(
        { error: "UPDATE_FAILED" },
        { status: 500 }
      )
    }
    if (!updated) {
      return NextResponse.json(
        { error: "STATE_CHANGED", message: "외상 상태가 변경되었습니다. 다시 확인해 주세요." },
        { status: 409 }
      )
    }

    // Audit — ROUND-A: fail-close. 이전 raw insert 는 error 를 무시했음.
    const auditFail = await auditOr500(supabase, {
      auth: authContext,
      action: newStatus === "collected" ? "credit_collected" : "credit_cancelled",
      entity_table: "credits",
      entity_id: credit_id,
      session_id: credit.session_id || null,
      before: { status: credit.status },
      metadata: { new_status: newStatus },
    })
    if (auditFail) return auditFail

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 : error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 : error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 : error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
