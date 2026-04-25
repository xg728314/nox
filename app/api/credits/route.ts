import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { archivedAtFilter } from "@/lib/session/archivedFilter"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * POST /api/credits — 외상 등록
 * GET  /api/credits — 외상 목록 조회 (?status=pending|collected|cancelled)
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to create credits." },
        { status: 403 }
      )
    }

    let body: {
      session_id?: string
      receipt_id?: string
      business_day_id?: string
      room_uuid?: string
      manager_membership_id?: string
      customer_name?: string
      customer_phone?: string
      amount?: number
      memo?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const { session_id, receipt_id, business_day_id, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo } = body

    // 필수 필드 검증 (3종 구조)
    if (!room_uuid || !isValidUUID(room_uuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "room_uuid is required and must be a valid UUID." },
        { status: 400 }
      )
    }
    if (!manager_membership_id || !isValidUUID(manager_membership_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "manager_membership_id is required and must be a valid UUID." },
        { status: 400 }
      )
    }
    if (!customer_name || customer_name.trim().length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "customer_name is required." },
        { status: 400 }
      )
    }
    if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "amount must be a positive number." },
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

    // 방 존재 확인
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", room_uuid)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (!room) {
      return NextResponse.json(
        { error: "ROOM_NOT_FOUND", message: "Room not found in this store." },
        { status: 404 }
      )
    }

    // 담당실장 멤버십 확인
    const { data: managerMembership } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("id", manager_membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "manager")
      .eq("status", "approved")
      .maybeSingle()

    if (!managerMembership) {
      return NextResponse.json(
        { error: "MANAGER_NOT_FOUND", message: "Manager membership not found in this store." },
        { status: 404 }
      )
    }

    // INSERT
    const insertData: Record<string, unknown> = {
      store_uuid: authContext.store_uuid,
      room_uuid,
      manager_membership_id,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone?.trim() || null,
      amount,
      memo: memo?.trim() || null,
      status: "pending",
    }

    if (session_id && isValidUUID(session_id)) insertData.session_id = session_id
    if (receipt_id && isValidUUID(receipt_id)) insertData.receipt_id = receipt_id
    if (business_day_id && isValidUUID(business_day_id)) insertData.business_day_id = business_day_id

    const { data: credit, error: insertError } = await supabase
      .from("credits")
      .insert(insertData)
      .select("id, store_uuid, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo, status, session_id, receipt_id, business_day_id, created_at")
      .single()

    if (insertError || !credit) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "Failed to create credit." },
        { status: 500 }
      )
    }

    // Audit — 2026-04-24 P1 fix: audit insert 실패 시 이전에는 조용히 무시.
    //   금전 레코드(외상) 는 반드시 감사 흔적이 있어야 하므로 실패 시 경고
    //   로그 남기고 호출자에게 부분 성공을 알린다. credit row 는 이미 생성
    //   됐으므로 롤백 없이 201 + audit_warning 플래그를 돌려줌.
    const { error: auditErr } = await supabase
      .from("audit_events")
      .insert({
        store_uuid: authContext.store_uuid,
        actor_profile_id: authContext.user_id,
        actor_membership_id: authContext.membership_id,
        actor_role: authContext.role,
        actor_type: authContext.role,
        session_id: session_id || null,
        entity_table: "credits",
        entity_id: credit.id,
        action: "credit_created",
        after: {
          room_uuid,
          manager_membership_id,
          customer_name: customer_name.trim(),
          amount,
          status: "pending",
        },
      })
    if (auditErr) {
      console.error(
        "[credits POST] audit insert FAILED — credit row created but audit missing.",
        { credit_id: credit.id, err: auditErr },
      )
      return NextResponse.json(
        {
          ...credit,
          audit_warning:
            "외상은 등록됐으나 감사 로그 저장 실패. 관리자에게 알리세요.",
        },
        { status: 201 },
      )
    }

    return NextResponse.json(credit, { status: 201 })
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view credits." },
        { status: 403 }
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

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get("status")

    // 2026-04-25: archived_at 필터 — 인쇄+archive 된 외상은 목록에서 숨김.
    //   per-table 탐지. credits 에 컬럼 없으면 no-op.
    const applyArchivedNull = await archivedAtFilter(supabase, "credits")

    // 2026-04-25: linked_account_id 는 migration 025 로 추가된 선택 컬럼.
    //   미적용 DB 에서는 `column does not exist` 로 전체 쿼리 실패 →
    //   외상 목록 자체가 안 뜸. base select 를 optional 컬럼 없이 만들고
    //   실패 시 fallback 을 쓴다.
    const BASE_COLS = "id, store_uuid, session_id, receipt_id, business_day_id, room_uuid, manager_membership_id, customer_name, customer_phone, amount, memo, status, collected_at, collected_by, created_at, updated_at"
    const FULL_COLS = `${BASE_COLS}, linked_account_id`

    type CreditRow = Record<string, unknown>
    type CreditQueryResult = {
      data: CreditRow[] | null
      error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null
    }

    async function runQuery(cols: string): Promise<CreditQueryResult> {
      let q = applyArchivedNull(
        supabase
          .from("credits")
          .select(cols)
          .eq("store_uuid", authContext.store_uuid)
          .is("deleted_at", null),
      ).order("created_at", { ascending: false })
      if (statusFilter && ["pending", "collected", "cancelled"].includes(statusFilter)) {
        q = q.eq("status", statusFilter)
      }
      if (authContext.role === "manager") {
        q = q.eq("manager_membership_id", authContext.membership_id)
      }
      const res = await q
      return {
        data: (res.data as unknown as CreditRow[]) ?? null,
        error: res.error
          ? {
              message: res.error.message,
              details: res.error.details,
              hint: res.error.hint,
              code: res.error.code,
            }
          : null,
      }
    }

    // 1차 시도: linked_account_id 포함. migration 025 미적용이면 42703.
    let result = await runQuery(FULL_COLS)
    if (result.error && result.error.code === "42703") {
      console.warn(
        "[credits GET] linked_account_id column missing — migration 025 미적용. 필드 제외 후 재시도.",
      )
      result = await runQuery(BASE_COLS)
    }
    const { data: credits, error: queryError } = result

    if (queryError) {
      // 서버에만 상세 기록. 클라이언트 응답엔 내부 정보 노출 금지.
      console.error("[credits GET] queryError:", queryError)
      return NextResponse.json(
        { error: "QUERY_FAILED" },
        { status: 500 }
      )
    }

    // 방 이름, 실장 이름 조회
    const creditRows = (credits ?? []) as CreditRow[]
    const roomUuids = [...new Set(creditRows.map(c => c.room_uuid as string))]
    const managerIds = [...new Set(creditRows.map(c => c.manager_membership_id as string))]

    const roomNameMap = new Map<string, string>()
    const managerNameMap = new Map<string, string>()

    if (roomUuids.length > 0) {
      // 2026-04-25 fix: rooms 테이블은 `room_name` 컬럼. 이전엔 존재하지
      //   않는 `name` 을 select → 목록 확장 시 NULL 이름 표시 버그.
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, room_name")
        .eq("store_uuid", authContext.store_uuid)
        .in("id", roomUuids)
      for (const r of rooms ?? []) roomNameMap.set(r.id, r.room_name)
    }

    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from("managers")
        .select("membership_id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("membership_id", managerIds)
      for (const m of managers ?? []) managerNameMap.set(m.membership_id, m.name)
    }

    const enriched = creditRows.map(c => ({
      ...c,
      room_name: roomNameMap.get(c.room_uuid as string) || null,
      manager_name: managerNameMap.get(c.manager_membership_id as string) || null,
    }))

    // R28-PII (2026-04-26): 개인정보 (손님 이름·전화) 응답 시 audit 기록.
    //   정보주체 요청 시 "누가 언제 봤는가" 답변 가능하게.
    //   행 본문(이름/전화)은 의도적으로 audit 에 안 넣음 — 감사 자체가 PII 가
    //   되면 안 됨. 누가/몇 건/어떤 status 만 기록.
    if (enriched.length > 0) {
      const hasPhone = enriched.some(c => Boolean((c as { customer_phone?: string | null }).customer_phone))
      // best-effort. audit 실패해도 응답은 그대로.
      logAuditEvent(supabase, {
        auth: authContext,
        action: "credits_viewed",
        entity_table: "credits",
        entity_id: authContext.store_uuid, // entity 단위로는 store
        status: "success",
        metadata: {
          row_count: enriched.length,
          status_filter: statusFilter,
          contains_phone: hasPhone,
        },
      }).catch(() => { /* silent — fail-open on audit, fail-close in mutations */ })
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      credits: enriched,
    })
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
