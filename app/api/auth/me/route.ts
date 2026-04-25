import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // R26: mfa_enabled + backup_codes_remaining 노출 (additive). /me/security
    //   페이지가 현재 상태를 알아야 적절한 UI 분기. 둘 다 booleans/숫자라
    //   민감한 secret 노출 위험 없음.
    let mfaEnabled = false
    let backupCodesRemaining = 0
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const sb = createClient(url, key)
        const { data: row } = await sb
          .from("user_mfa_settings")
          .select("is_enabled, backup_codes_hashed")
          .eq("user_id", authContext.user_id)
          .is("deleted_at", null)
          .maybeSingle()
        const r = row as { is_enabled?: boolean; backup_codes_hashed?: string[] } | null
        mfaEnabled = !!r?.is_enabled
        backupCodesRemaining = Array.isArray(r?.backup_codes_hashed) ? r!.backup_codes_hashed!.length : 0
      }
    } catch {
      // best-effort — me 응답은 MFA 조회 실패해도 정상 동작.
    }

    return NextResponse.json({
      user_id: authContext.user_id,
      membership_id: authContext.membership_id,
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      membership_status: authContext.membership_status,
      // Phase 5 additive: mobile monitor needs to know when to show
      // floor-wide (non-own-floor) tabs. Additive only — existing
      // consumers that ignore this field are unaffected.
      is_super_admin: authContext.is_super_admin,
      mfa_enabled: mfaEnabled,
      backup_codes_remaining: backupCodesRemaining,
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
