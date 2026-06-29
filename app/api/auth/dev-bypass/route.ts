/**
 * POST /api/auth/dev-bypass
 *
 * 비번 입력 없이 cookie 발급 — 환경변수로 토글.
 * ⚠ 비활성 (env 안 설정) 이면 403. 활성이어도 1개 계정만 자동 로그인.
 *
 * 활성화 (Cloud Run env vars):
 *   DEV_BYPASS_ENABLED=true
 *   DEV_BYPASS_EMAIL=user@example.com
 *   DEV_BYPASS_PASSWORD=...
 *
 * 끄려면: DEV_BYPASS_ENABLED 제거 또는 false 로 변경 + 재배포.
 *
 * 흐름:
 *   1. env 검증 — 셋 다 있어야 작동
 *   2. supabase signInWithPassword (정상 로그인 흐름과 동일, MFA skip)
 *   3. access_token + refresh_token 을 HttpOnly cookie set
 *   4. 응답 — 클라이언트가 /m 으로 redirect
 *
 * 사용자 요청 (2026-06-28): "개발자가 로그인하기 귀찮대서" — 비번 입력
 *   화면 자체 없애기. 토글 가능.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST() {
  const enabled = process.env.DEV_BYPASS_ENABLED === "true"
  const email = process.env.DEV_BYPASS_EMAIL ?? ""
  const password = process.env.DEV_BYPASS_PASSWORD ?? ""
  if (!enabled || !email || !password) {
    return NextResponse.json({ error: "DEV_BYPASS_DISABLED" }, { status: 403 })
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      return NextResponse.json({ error: "SUPABASE_ENV_MISSING" }, { status: 500 })
    }
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
      return NextResponse.json(
        { error: "AUTH_FAILED", message: error?.message ?? "no session" },
        { status: 401 },
      )
    }

    // SESSION_MAX_S — dev-bypass 는 30일 (정상 로그인의 5시간보다 길게).
    //   개발자 편의 — 매번 갱신 안 되도록.
    const SESSION_MAX_S = 30 * 24 * 60 * 60
    const res = NextResponse.json({
      ok: true,
      user_id: data.user.id,
      access_token: data.session.access_token,
    })
    res.cookies.set({
      name: "nox_access_token",
      value: data.session.access_token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_S,
    })
    if (data.session.refresh_token) {
      res.cookies.set({
        name: "nox_refresh_token",
        value: data.session.refresh_token,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_S,
      })
    }
    return res
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}
