/**
 * GET /api/points   내 잔액 + 최근 거래
 * POST /api/points  포인트 충전 (테스트/관리자용).
 *   body: { amount, kind: 'topup'|'adjustment', memo? }
 *   ⚠ 실제 결제 통합은 다음 단계 — 지금은 super_admin 만 가능.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = getServiceClient()
    const { data: bal } = await supabase
      .from("points_balance")
      .select("balance, updated_at")
      .eq("user_id", auth.user_id)
      .maybeSingle()
    const { data: tx } = await supabase
      .from("points_transactions")
      .select("id, amount, balance_after, kind, ref_type, ref_id, memo, created_at")
      .eq("user_id", auth.user_id)
      .order("created_at", { ascending: false })
      .limit(30)
    return NextResponse.json({
      balance: (bal as { balance: number } | null)?.balance ?? 0,
      transactions: tx ?? [],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      amount?: number
      kind?: "topup" | "adjustment"
      memo?: string
    }
    if (!Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return NextResponse.json({ error: "BAD_AMOUNT" }, { status: 400 })
    }
    // super_admin 만 (실 결제 통합 전)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "FORBIDDEN", message: "결제 통합 준비 중" }, { status: 403 })
    }
    const supabase = getServiceClient()
    const { data: cur } = await supabase
      .from("points_balance")
      .select("balance")
      .eq("user_id", auth.user_id)
      .maybeSingle()
    const curBalance = (cur as { balance: number } | null)?.balance ?? 0
    const newBalance = curBalance + (body.amount ?? 0)
    await supabase
      .from("points_balance")
      .upsert({
        user_id: auth.user_id,
        balance: newBalance,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
    await supabase.from("points_transactions").insert({
      user_id: auth.user_id,
      amount: body.amount,
      balance_after: newBalance,
      kind: body.kind ?? "topup",
      memo: body.memo ?? null,
    })
    return NextResponse.json({ ok: true, balance: newBalance })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
