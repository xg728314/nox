import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"

// 세션 메타 수정 — 실장(manager_*) + 손님(customer_*) 변경
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ session_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." }, { status: 403 })
    }

    const { session_id } = await params
    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id must be a valid UUID." }, { status: 400 })
    }

    const parsed = await parseJsonBody<{
      manager_name?: string | null
      manager_membership_id?: string | null
      is_external_manager?: boolean
      customer_id?: string | null
      customer_name_snapshot?: string | null
      customer_party_size?: number
    }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const hasManagerField = body.manager_name !== undefined || body.manager_membership_id !== undefined || body.is_external_manager !== undefined
    const hasCustomerField = body.customer_id !== undefined || body.customer_name_snapshot !== undefined || body.customer_party_size !== undefined
    if (!hasManagerField && !hasCustomerField) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "At least one field is required." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-03 R-Perf: session 조회 + receipts(finalized) 체크 + 옵션
    //   manager 검증을 단일 Promise.all 로 fire — 직렬 3 RTT → 1 RTT.
    //   각 query 는 서로 의존 X (전부 session_id + store_uuid 만 필요).
    //   manager 검증은 body 에 manager_membership_id 가 있고 UUID 일 때만.
    const wantsManagerVerify =
      hasManagerField &&
      body.is_external_manager !== true &&
      body.manager_membership_id !== null &&
      body.manager_membership_id !== undefined &&
      isValidUUID(body.manager_membership_id)

    const [sessionFullRes, receiptRes, mgrCheckRes] = await Promise.all([
      supabase
        .from("room_sessions")
        .select("id, store_uuid, status, manager_name, manager_membership_id, is_external_manager, customer_id, customer_name_snapshot, customer_party_size")
        .eq("id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .maybeSingle(),
      supabase
        .from("receipts")
        .select("id, status")
        .eq("session_id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      wantsManagerVerify
        ? supabase
            .from("store_memberships")
            .select("id")
            .eq("id", body.manager_membership_id!)
            .eq("store_uuid", authContext.store_uuid)
            .eq("role", "manager")
            .eq("status", "approved")
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as { data: null; error: null }),
    ])

    let session: Record<string, unknown> | null = null
    if (!sessionFullRes.error && sessionFullRes.data) {
      session = sessionFullRes.data as Record<string, unknown>
    } else {
      // customer columns 부재 fallback (migration 014 미적용 환경).
      const { data: s2, error: sErr2 } = await supabase
        .from("room_sessions")
        .select("id, store_uuid, status, manager_name, manager_membership_id, is_external_manager")
        .eq("id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .maybeSingle()
      if (sErr2 || !s2) {
        return NextResponse.json({ error: "SESSION_NOT_FOUND", message: "Session not found." }, { status: 404 })
      }
      session = s2 as Record<string, unknown>
      if (hasCustomerField) {
        return NextResponse.json({ error: "MIGRATION_REQUIRED", message: "Customer columns not available. Apply migration 014." }, { status: 400 })
      }
    }

    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND", message: "Session not found." }, { status: 404 })
    }

    // finalized 세션 차단
    const receipt = receiptRes.data
    if (receipt && receipt.status === "finalized") {
      return NextResponse.json({ error: "ALREADY_FINALIZED", message: "정산이 확정된 세션입니다." }, { status: 409 })
    }

    // Build update payload
    const updatePayload: Record<string, string | boolean | number | null> = {
      updated_at: new Date().toISOString(),
    }
    const beforeState: Record<string, unknown> = {}
    const afterState: Record<string, unknown> = {}
    let auditAction = "session_updated"

    // ── Manager fields ──
    if (hasManagerField) {
      auditAction = "session_manager_updated"
      const isExternal = body.is_external_manager === true
      const managerName = body.manager_name === null ? null : (body.manager_name?.trim() || null)
      let managerMembershipId: string | null
      if (isExternal) {
        managerMembershipId = null
      } else if (body.manager_membership_id === null) {
        managerMembershipId = null
      } else if (body.manager_membership_id !== undefined) {
        if (!isValidUUID(body.manager_membership_id)) {
          return NextResponse.json({ error: "BAD_REQUEST", message: "manager_membership_id must be a valid UUID." }, { status: 400 })
        }
        // 2026-04-24 P0 fix: 같은 매장의 승인된 manager 만 허용.
        // 2026-05-03 R-Perf: 위 Promise.all 에서 사전 검증 — 결과만 사용.
        if (mgrCheckRes.error) {
          return NextResponse.json(
            { error: "MANAGER_VERIFY_FAILED", message: "실장 검증에 실패했습니다." },
            { status: 500 },
          )
        }
        if (!mgrCheckRes.data) {
          return NextResponse.json(
            {
              error: "MANAGER_INVALID",
              message: "지정한 실장이 이 매장 소속의 승인된 실장이 아닙니다.",
            },
            { status: 403 },
          )
        }
        managerMembershipId = body.manager_membership_id
      } else {
        managerMembershipId = session.manager_membership_id as string | null
      }
      updatePayload.is_external_manager = isExternal
      updatePayload.manager_membership_id = managerMembershipId
      updatePayload.manager_name = managerName
      beforeState.manager_name = session.manager_name
      beforeState.manager_membership_id = session.manager_membership_id
      beforeState.is_external_manager = session.is_external_manager
      afterState.manager_name = managerName
      afterState.manager_membership_id = managerMembershipId
      afterState.is_external_manager = isExternal
    }

    // ── Customer fields ──
    if (hasCustomerField) {
      auditAction = hasManagerField ? "session_updated" : "session_customer_updated"
      if (body.customer_id !== undefined) {
        if (body.customer_id !== null && !isValidUUID(body.customer_id)) {
          return NextResponse.json({ error: "BAD_REQUEST", message: "customer_id must be a valid UUID." }, { status: 400 })
        }
        updatePayload.customer_id = body.customer_id
        beforeState.customer_id = session.customer_id
        afterState.customer_id = body.customer_id
      }
      if (body.customer_name_snapshot !== undefined) {
        updatePayload.customer_name_snapshot = body.customer_name_snapshot
        beforeState.customer_name_snapshot = session.customer_name_snapshot
        afterState.customer_name_snapshot = body.customer_name_snapshot
      }
      if (body.customer_party_size !== undefined) {
        updatePayload.customer_party_size = Math.max(0, Math.floor(body.customer_party_size))
        beforeState.customer_party_size = session.customer_party_size
        afterState.customer_party_size = updatePayload.customer_party_size
      }
    }

    // Update with fallback SELECT (customer columns may not exist yet)
    let updated: Record<string, unknown> | null = null
    const { data: u1, error: uErr1 } = await supabase
      .from("room_sessions")
      .update(updatePayload)
      .eq("id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("id, manager_name, manager_membership_id, is_external_manager, customer_id, customer_name_snapshot, customer_party_size")
      .single()

    if (!uErr1 && u1) {
      updated = u1 as Record<string, unknown>
    } else {
      // Fallback: customer columns may not exist
      const { data: u2, error: uErr2 } = await supabase
        .from("room_sessions")
        .update(updatePayload)
        .eq("id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .select("id, manager_name, manager_membership_id, is_external_manager")
        .single()

      if (uErr2 || !u2) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: uErr2?.message || uErr1?.message || "Failed to update session." }, { status: 500 })
      }
      updated = u2 as Record<string, unknown>
    }

    if (!updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: "Failed to update session." }, { status: 500 })
    }

    // 2026-05-03 R-Perf: audit 은 background fire — 응답 latency 차감 100~200ms.
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "room_sessions",
      entity_id: session_id,
      action: auditAction,
      before: beforeState,
      after: afterState,
    }).catch((e) => {
      console.warn("[session PATCH] audit failed:", e instanceof Error ? e.message : e)
    })

    return NextResponse.json({
      session_id: updated.id,
      manager_name: updated.manager_name,
      manager_membership_id: updated.manager_membership_id,
      is_external_manager: updated.is_external_manager,
      customer_id: updated.customer_id ?? null,
      customer_name_snapshot: updated.customer_name_snapshot ?? null,
      customer_party_size: updated.customer_party_size ?? 0,
    })
  } catch (error) {
    return handleRouteError(error, "[session_id]")
  }
}
