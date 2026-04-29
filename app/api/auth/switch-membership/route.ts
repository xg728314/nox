import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/auth/switch-membership
 *
 * 활성 membership 전환. 호출자가 가진 approved memberships 사이에서만 가능.
 *   target_membership_id 를 is_primary=true 로, 기존 primary 를 false 로
 *   원자적 swap. login → resolveAuthContext 가 is_primary=true row 를 읽어
 *   새 매장을 활성 컨텍스트로 사용한다.
 *
 * Flow (UI 측):
 *   1) 사용자가 매장 클릭
 *   2) POST /api/auth/switch-membership { target_membership_id }
 *   3) 서버가 is_primary swap → 200 ok
 *   4) UI 가 logout 후 login 화면으로 이동 → 사용자 재로그인 시 새 매장으로
 *      세션 시작.
 *
 * 권한:
 *   - 일반 user: 본인이 소유한 (profile_id 일치) approved membership 만 전환.
 *   - super_admin: 본인 소유 membership 만 (super_admin 도 다른 사람 membership
 *     은 못 만짐 — admin scope 가 아닌 self-service 작업).
 *
 * 보안:
 *   - target 이 본인 소유 + approved + not deleted 인지 강제 검증.
 *   - 동시성: 단일 transaction 내 swap (UPDATE ... is_primary = (id = target)).
 *   - 회귀 방지: status='approved' 가 아닌 row 는 primary 못 됨.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const body = await request.json().catch(() => ({})) as { target_membership_id?: unknown }
    const targetId = typeof body.target_membership_id === "string" ? body.target_membership_id : ""
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_membership_id must be UUID" }, { status: 400 })
    }

    const supabase = supa()

    // 1. target 검증 — 본인 소유 + approved + not deleted
    const { data: target, error: tErr } = await supabase
      .from("store_memberships")
      .select("id, profile_id, store_uuid, status, is_primary, deleted_at")
      .eq("id", targetId)
      .maybeSingle()
    if (tErr || !target) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const t = target as {
      id: string; profile_id: string; store_uuid: string;
      status: string; is_primary: boolean; deleted_at: string | null;
    }
    if (t.profile_id !== auth.user_id) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "본인 소속 멤버십이 아닙니다." }, { status: 403 })
    }
    if (t.deleted_at) {
      return NextResponse.json({ error: "MEMBERSHIP_DELETED" }, { status: 400 })
    }
    if (t.status !== "approved") {
      return NextResponse.json({ error: "MEMBERSHIP_NOT_APPROVED", message: "승인된 멤버십만 전환 가능합니다." }, { status: 400 })
    }

    // 2. 이미 primary 면 no-op (200 ok)
    if (t.is_primary) {
      return NextResponse.json({ ok: true, already_primary: true, store_uuid: t.store_uuid })
    }

    // 3. swap — 본인의 모든 membership 을 (id = target) 으로 is_primary 갱신.
    //    PostgREST 단일 update 로 일괄 처리.
    const { error: sErr } = await supabase
      .from("store_memberships")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("profile_id", auth.user_id)
      .eq("is_primary", true)
    if (sErr) {
      return NextResponse.json({ error: "DB_ERROR", message: sErr.message }, { status: 500 })
    }

    const { error: pErr } = await supabase
      .from("store_memberships")
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq("id", targetId)
    if (pErr) {
      return NextResponse.json({ error: "DB_ERROR", message: pErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      switched_to: { membership_id: t.id, store_uuid: t.store_uuid },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
