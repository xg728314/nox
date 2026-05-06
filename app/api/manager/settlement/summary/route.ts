import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getManagerSettlementSummary } from "@/lib/server/queries/manager/settlementSummary"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { resolveOwnerVisibility } from "@/lib/settlement/services/ownerVisibility"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const paramBusinessDayId = searchParams.get("business_day_id")

    try {
      const data = await getManagerSettlementSummary(authContext, { business_day_id: paramBusinessDayId })

      // 2026-05-06 fix: owner 가시성 토글 적용. CLAUDE.md 잠긴 규칙:
      //   "사장이 볼 수 없음: 실장 개별 수익, 아가씨 개별 수익".
      //   기존: owner 가 이 endpoint 호출하면 manager 가 toggle 끄든 켜든 항상
      //   manager_amount/hostess_amount 노출 → 비즈니스 규칙 위반.
      //   수정: owner 일 때 모든 manager 가 toggle 켰을 때만 노출. 한 명이라도
      //   비공개면 마스킹 (보수적).
      if (authContext.role === "owner" && data && typeof data === "object") {
        const supabase = getServiceClient()
        const { showManager, showHostess } = await resolveOwnerVisibility(
          supabase,
          authContext.store_uuid,
        )
        const dataAny = data as Record<string, unknown>
        if (!showManager) {
          dataAny.manager_amount = null
          if (Array.isArray(dataAny.hostesses)) {
            dataAny.hostesses = (dataAny.hostesses as Array<Record<string, unknown>>).map((h) => ({
              ...h,
              manager_amount: null,
            }))
          }
        }
        if (!showHostess) {
          dataAny.hostess_amount = null
          if (Array.isArray(dataAny.hostesses)) {
            dataAny.hostesses = (dataAny.hostesses as Array<Record<string, unknown>>).map((h) => ({
              ...h,
              hostess_amount: null,
            }))
          }
        }
      }

      return NextResponse.json(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      return NextResponse.json(
        { error: "QUERY_FAILED", message: msg },
        { status: 500 }
      )
    }
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

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
