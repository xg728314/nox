import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/cafe/account?store_uuid=X — 카페 계좌 정보 (입금 결제용, 인증 누구나).
 * PUT /api/cafe/account — 카페 owner 가 자기 매장 계좌 등록/수정.
 */

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const store_uuid = url.searchParams.get("store_uuid")
    if (!store_uuid || !isValidUUID(store_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data } = await svc.supabase
      .from("cafe_account_info")
      .select("store_uuid, bank_name, account_number, account_holder, is_active, updated_at")
      .eq("store_uuid", store_uuid)
      .maybeSingle()
    return NextResponse.json({ account: data ?? null })
  } catch (e) {
    return handleRouteError(e, "cafe/account GET")
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner only" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{
      bank_name?: string | null
      account_number?: string | null
      account_holder?: string | null
      is_active?: boolean
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data, error } = await svc.supabase
      .from("cafe_account_info")
      .upsert({
        store_uuid: auth.store_uuid,
        bank_name: b.bank_name?.trim() || null,
        account_number: b.account_number?.trim() || null,
        account_holder: b.account_holder?.trim() || null,
        is_active: b.is_active ?? true,
      }, { onConflict: "store_uuid" })
      .select("store_uuid, bank_name, account_number, account_holder, is_active")
      .single()
    if (error) return NextResponse.json({ error: "UPSERT_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ account: data })
  } catch (e) {
    return handleRouteError(e, "cafe/account PUT")
  }
}
