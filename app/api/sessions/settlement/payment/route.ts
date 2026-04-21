import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"

const VALID_METHODS = ["cash", "card", "credit", "mixed"] as const

/**
 * STEP-4C: Cutover to register_payment_atomic RPC.
 *
 * POST /api/sessions/settlement/payment
 *
 * All money-critical writes (optional credits INSERT + receipt UPDATE)
 * are now executed in a single DB transaction. The RPC locks the receipt
 * FOR UPDATE, verifies `payment_method IS NULL`, inserts any credit row,
 * and updates the receipt — any failure mid-flight rolls back BOTH writes.
 * Orphan-credit races (the residual STEP-003 concern) are eliminated.
 *
 * App-layer responsibilities after cutover:
 *   - auth / role gate
 *   - request parsing + shape validation
 *   - UUID validation
 *   - pre-flight customer_name check (fast-fail before the RPC call)
 *   - resolve latest receipt.id (safe stale read — RPC re-locks and re-checks
 *     payable state; stale data only affects which receipt we POINT AT)
 *   - resolve store_settings.card_fee_rate (safe stale read — consistent with
 *     prior behavior; fee rate is immutable within an operating day per
 *     business rule "영업일 진행 중 설정 변경 불가")
 *   - audit write after success
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      payment_method?: string
      cash_amount?: number
      card_amount?: number
      credit_amount?: number
      manager_card_margin?: number
      customer_name?: string
      customer_phone?: string
    }>(request)
    if (parsed.error) return parsed.error
    const {
      session_id,
      payment_method,
      cash_amount,
      card_amount,
      credit_amount,
      manager_card_margin,
      customer_name,
      customer_phone,
    } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required and must be a valid UUID." },
        { status: 400 }
      )
    }

    if (!payment_method || !(VALID_METHODS as readonly string[]).includes(payment_method)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "payment_method must be one of: cash, card, credit, mixed." },
        { status: 400 }
      )
    }

    const cashAmt = cash_amount ?? 0
    const cardAmt = card_amount ?? 0
    const creditAmt = credit_amount ?? 0
    const managerMargin = manager_card_margin ?? 0

    if (cashAmt < 0 || cardAmt < 0 || creditAmt < 0 || managerMargin < 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "금액은 0 이상이어야 합니다." },
        { status: 400 }
      )
    }

    // Pre-flight customer_name check — preserves pre-cutover 400 shape
    // (the RPC would also raise CUSTOMER_NAME_REQUIRED, but this avoids
    // an RPC round-trip for a simple shape error).
    if (
      (payment_method === "credit" || (payment_method === "mixed" && creditAmt > 0)) &&
      (!customer_name || customer_name.trim().length === 0)
    ) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "외상 결제 시 customer_name은 필수입니다." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // ── Safe stale reads: receipt id + card fee rate ────────────────────
    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .select("id")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (receiptError || !receipt) {
      return NextResponse.json(
        { error: "RECEIPT_NOT_FOUND", message: "정산 내역이 없습니다. 먼저 정산을 생성하세요." },
        { status: 404 }
      )
    }

    const { data: settings } = await supabase
      .from("store_settings")
      .select("card_fee_rate")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()

    const cardFeeRate = Number(settings?.card_fee_rate ?? 0.05)

    // ── STEP-4C: atomic payment via DB RPC ──────────────────────────────
    const { data: rpcData, error: rpcError } = await supabase.rpc("register_payment_atomic", {
      p_session_id: session_id,
      p_store_uuid: authContext.store_uuid,
      p_receipt_id: receipt.id,
      p_payment_method: payment_method,
      p_cash_amount: cashAmt,
      p_card_amount: cardAmt,
      p_credit_amount: creditAmt,
      p_manager_card_margin: managerMargin,
      p_card_fee_rate: cardFeeRate,
      p_customer_name: customer_name ?? null,
      p_customer_phone: customer_phone ?? null,
      p_manager_membership_id: authContext.membership_id,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ""

      if (msg.startsWith("RECEIPT_NOT_FOUND")) {
        return NextResponse.json(
          { error: "RECEIPT_NOT_FOUND", message: "정산 내역이 없습니다. 먼저 정산을 생성하세요." },
          { status: 404 }
        )
      }
      // Check ALREADY_PAID_RACE first because it also starts with ALREADY_PAID
      if (msg.startsWith("ALREADY_PAID_RACE")) {
        return NextResponse.json(
          { error: "ALREADY_PAID", message: "결제가 동시에 등록되었습니다. 다시 확인해 주세요." },
          { status: 409 }
        )
      }
      if (msg.startsWith("ALREADY_PAID")) {
        return NextResponse.json(
          { error: "ALREADY_PAID", message: "이미 결제 방식이 등록된 영수증입니다." },
          { status: 409 }
        )
      }
      if (msg.startsWith("AMOUNT_MISMATCH")) {
        return NextResponse.json(
          { error: "AMOUNT_MISMATCH", message: "결제 합계가 총액과 일치하지 않습니다." },
          { status: 400 }
        )
      }
      if (msg.startsWith("INVALID_METHOD_COMPOSITION")) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "결제 방식과 금액 구성이 일치하지 않습니다." },
          { status: 400 }
        )
      }
      if (msg.startsWith("INVALID_METHOD")) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "payment_method must be one of: cash, card, credit, mixed." },
          { status: 400 }
        )
      }
      if (msg.startsWith("NEGATIVE_AMOUNT") || msg.startsWith("NEGATIVE_FEE_RATE")) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "금액은 0 이상이어야 합니다." },
          { status: 400 }
        )
      }
      if (msg.startsWith("CUSTOMER_NAME_REQUIRED")) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "외상 결제 시 customer_name은 필수입니다." },
          { status: 400 }
        )
      }
      // Defensive fallback
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "결제 정보 저장에 실패했습니다." },
        { status: 500 }
      )
    }

    const result = rpcData as {
      receipt_id: string
      session_id: string
      payment_method: string
      gross_total: number
      cash_amount: number
      card_amount: number
      credit_amount: number
      card_fee_rate: number
      card_fee_amount: number
      manager_card_margin: number
      credit_id: string | null
      status: string
    }

    // ── Audit (app-layer post-success) ──────────────────────────────────
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "receipts",
      entity_id: result.receipt_id,
      action: "payment_registered",
      after: {
        payment_method: result.payment_method,
        cash_amount: result.cash_amount,
        card_amount: result.card_amount,
        credit_amount: result.credit_amount,
        card_fee_rate: result.card_fee_rate,
        card_fee_amount: result.card_fee_amount,
        manager_card_margin: result.manager_card_margin,
        credit_id: result.credit_id,
      },
    })

    return NextResponse.json({
      receipt_id: result.receipt_id,
      session_id,
      payment_method: result.payment_method,
      gross_total: result.gross_total,
      cash_amount: result.cash_amount,
      card_amount: result.card_amount,
      credit_amount: result.credit_amount,
      card_fee_rate: result.card_fee_rate,
      card_fee_amount: result.card_fee_amount,
      manager_card_margin: result.manager_card_margin,
      credit_id: result.credit_id,
      status: result.status,
    })
  } catch (error) {
    return handleRouteError(error, "payment")
  }
}
