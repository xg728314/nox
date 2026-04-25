import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { isValidUUID } from "@/lib/validation"

/**
 * POST /api/sessions/receipt/archive
 *
 * 인쇄 완료 후 세션/영수증/참여자/주문/선정산/외상 을 일괄 archive.
 *
 * 동작 원칙 (2026-04-24):
 *   - hard DELETE 아님. archived_at 타임스탬프만 찍음.
 *   - 모든 active UI 쿼리는 `archived_at IS NULL` 필터 사용.
 *   - 세무 5년 보관 + 분쟁 증빙 유지.
 *   - 권한: owner/manager 만. 정산 finalized 상태에서만 허용.
 *
 * body: { receipt_id: string }
 *
 * 응답: { receipt_id, session_id, archived_at }
 */
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "archive 권한이 없습니다." },
        { status: 403 },
      )
    }

    const parsed = await parseJsonBody<{ receipt_id?: string }>(request)
    if (parsed.error) return parsed.error
    const receiptId = parsed.body.receipt_id
    if (!receiptId || !isValidUUID(receiptId)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "receipt_id 가 필요합니다." },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data, error } = await supabase.rpc("archive_receipt_bundle", {
      p_receipt_id: receiptId,
      p_store_uuid: auth.store_uuid,
      p_actor_id: auth.user_id,
      p_actor_membership: auth.membership_id,
    })

    if (error) {
      const msg = error.message ?? ""
      if (msg.includes("RECEIPT_NOT_FOUND")) {
        return NextResponse.json(
          { error: "RECEIPT_NOT_FOUND", message: "영수증을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
      if (msg.includes("RECEIPT_NOT_FINALIZED")) {
        return NextResponse.json(
          {
            error: "RECEIPT_NOT_FINALIZED",
            message: "정산이 확정(finalized)된 영수증만 archive 가능합니다.",
          },
          { status: 409 },
        )
      }
      if (msg.includes("ALREADY_ARCHIVED")) {
        return NextResponse.json(
          { error: "ALREADY_ARCHIVED", message: "이미 archive 된 영수증입니다." },
          { status: 409 },
        )
      }
      console.error("[receipt/archive] rpc error", error)
      return NextResponse.json(
        { error: "ARCHIVE_FAILED", message: "archive 처리 실패." },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "예상치 못한 오류." },
      { status: 500 },
    )
  }
}
