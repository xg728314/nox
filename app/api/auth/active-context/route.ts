import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * /api/auth/active-context  (R-super-admin-view, 2026-04-30)
 *
 * super_admin 전용. 활성 매장 / 역할 cookie override 를 설정/해제.
 *
 * PUT  { store_uuid?, role? }
 *   - store_uuid : 36자 UUID. 본인 approved membership 이 있는 매장만 허용.
 *   - role       : "owner" | "manager" | "staff" | "hostess" | "waiter".
 *                  단, super_admin 도 본인 권한 안에서만 view 가능 — role
 *                  override 는 enum 만 교체 (membership_id 는 store override
 *                  결과 그대로). audit 로그에는 actor_role=override 값,
 *                  actor_membership_id=실제 owner row 가 기록됨.
 *
 * DELETE
 *   - 두 cookie 모두 삭제 → 본인 primary membership 으로 복귀.
 *
 * Cookie:
 *   - nox_active_store / nox_active_role
 *   - HttpOnly, sameSite=lax, path=/, secure(prod), maxAge=8h
 *
 * 보안:
 *   - 비-super_admin 호출 → 403.
 *   - 비-super_admin 의 cookie 가 어떤 식으로든 설정되어 있어도 resolveAuthContext
 *     이 무시 (override apply 시 is_super_admin 체크).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_ROLES = new Set(["owner", "manager", "waiter", "staff", "hostess"])
const COOKIE_MAX_AGE_S = 8 * 60 * 60

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "운영자(super_admin) 만 사용 가능합니다." }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      store_uuid?: unknown
      role?: unknown
    }

    const storeUuid = typeof body.store_uuid === "string" ? body.store_uuid.trim() : ""
    const role = typeof body.role === "string" ? body.role.trim() : ""

    if (storeUuid && !/^[0-9a-f-]{36}$/i.test(storeUuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "store_uuid 형식 오류" }, { status: 400 })
    }
    if (role && !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "role 값 오류" }, { status: 400 })
    }
    if (!storeUuid && !role) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "store_uuid 또는 role 중 하나는 필요합니다." }, { status: 400 })
    }

    // store_uuid 검증 — 본인 approved membership 존재 확인
    if (storeUuid) {
      const supabase = supa()
      const { data: m } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("profile_id", auth.user_id)
        .eq("store_uuid", storeUuid)
        .eq("status", "approved")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()
      if (!m) {
        return NextResponse.json({
          error: "MEMBERSHIP_NOT_FOUND",
          message: "이 매장에 활성 멤버십이 없습니다. 먼저 owner membership 을 등록하세요.",
        }, { status: 403 })
      }
    }

    const res = NextResponse.json({
      ok: true,
      active_store: storeUuid || null,
      active_role: role || null,
    })

    const secure = process.env.NODE_ENV === "production"

    if (storeUuid) {
      res.cookies.set({
        name: "nox_active_store",
        value: storeUuid,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
        maxAge: COOKIE_MAX_AGE_S,
      })
    }
    if (role) {
      res.cookies.set({
        name: "nox_active_role",
        value: role,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
        maxAge: COOKIE_MAX_AGE_S,
      })
    }

    return res
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const res = NextResponse.json({ ok: true, active_store: null, active_role: null })
    res.cookies.set({
      name: "nox_active_store",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
    res.cookies.set({
      name: "nox_active_role",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
    return res
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
