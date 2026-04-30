import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-NEXT-API — GET /api/owner/accounts/[membership_id]
 *
 * Owner-only same-store membership detail.
 *
 * Strict rules:
 *   - role gate BEFORE DB
 *   - membership must belong to authContext.store_uuid (cross-store blocked)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ membership_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { membership_id } = await params
    if (!membership_id || !isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: membership, error } = await supabase
      .from("store_memberships")
      .select("id, profile_id, store_uuid, role, status, is_primary, approved_by, approved_at, created_at, updated_at")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    // 2026-04-30 fix: profiles 테이블에 email 컬럼 없음 (auth.users 만 가짐).
    //   기존 .select(..., email) 은 PostgREST 에러 → profile null →
    //   UI 가 모든 row 를 user_id prefix 로 fallback. email 은 별도 lookup.
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, nickname, phone, created_at, updated_at")
      .eq("id", membership.profile_id)
      .maybeSingle()

    let email: string | null = null
    try {
      const { data: userData } = await supabase.auth.admin.getUserById(
        membership.profile_id as string,
      )
      email = userData?.user?.email ?? null
    } catch { /* email 조회 실패 시 null fallback */ }

    return NextResponse.json({
      membership: {
        membership_id: membership.id,
        profile_id: membership.profile_id,
        store_uuid: membership.store_uuid,
        role: membership.role,
        status: membership.status,
        is_primary: membership.is_primary,
        approved_by: membership.approved_by,
        approved_at: membership.approved_at,
        created_at: membership.created_at,
        updated_at: membership.updated_at,
      },
      profile: profile
        ? {
            profile_id: profile.id,
            full_name: profile.full_name,
            nickname: profile.nickname,
            phone: profile.phone,
            email,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
          }
        : null,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
