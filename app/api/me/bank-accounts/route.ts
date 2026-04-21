import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET  /api/me/bank-accounts — 본인 계좌 목록
 * POST /api/me/bank-accounts — 본인 계좌 등록
 *
 * 내정보(자기 자신) 전용. 다른 사람의 계좌는 이 라우트로 조회/등록 불가.
 * Scoping: authContext.membership_id (not store_uuid alone).
 */

type Body = {
  bank_name?: string
  account_number?: string
  holder_name?: string
  is_default?: boolean
  is_active?: boolean
}

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: accounts, error } = await supabase
      .from("membership_bank_accounts")
      .select("id, bank_name, account_number, holder_name, is_default, is_active, created_at, updated_at")
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ accounts: accounts ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    let body: Body
    try { body = await request.json() }
    catch { return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 }) }

    const bank_name = (body.bank_name ?? "").trim()
    const account_number = (body.account_number ?? "").trim()
    const holder_name = (body.holder_name ?? "").trim()
    if (!bank_name) return NextResponse.json({ error: "BAD_REQUEST", message: "은행명을 입력하세요." }, { status: 400 })
    if (!account_number) return NextResponse.json({ error: "BAD_REQUEST", message: "계좌번호를 입력하세요." }, { status: 400 })
    if (!holder_name) return NextResponse.json({ error: "BAD_REQUEST", message: "예금주를 입력하세요." }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 기본계좌 여부 결정:
    //   - 명시적으로 is_default=true 전달 → 기존 기본계좌 해제 후 이걸 기본으로
    //   - is_default 미지정 && 기존에 계좌 없음 → 첫 계좌를 자동 기본으로
    const { data: existing } = await supabase
      .from("membership_bank_accounts")
      .select("id, is_default")
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)

    const isFirst = (existing ?? []).length === 0
    const wantDefault = body.is_default === true || isFirst

    if (wantDefault) {
      // 기존 기본계좌를 모두 해제 (partial unique index 위반 방지)
      await supabase
        .from("membership_bank_accounts")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("membership_id", authContext.membership_id)
        .eq("store_uuid", authContext.store_uuid)
        .eq("is_default", true)
        .is("deleted_at", null)
    }

    const { data: inserted, error: insertError } = await supabase
      .from("membership_bank_accounts")
      .insert({
        store_uuid: authContext.store_uuid,
        membership_id: authContext.membership_id,
        bank_name,
        account_number,
        holder_name,
        is_default: wantDefault,
        is_active: body.is_active !== false,
      })
      .select("id, bank_name, account_number, holder_name, is_default, is_active, created_at")
      .single()

    if (insertError || !inserted) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insertError?.message || "등록 실패" }, { status: 500 })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "membership_bank_accounts",
      entity_id: inserted.id,
      action: "bank_account_created",
      after: { bank_name, account_number, holder_name, is_default: wantDefault },
    })

    return NextResponse.json(inserted, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
