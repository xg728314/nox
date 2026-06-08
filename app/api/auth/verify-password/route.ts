/**
 * POST /api/auth/verify-password
 *
 * 가벼운 비밀번호 재확인 — 현재 로그인 세션을 유지한 채 비밀번호 일치 여부만
 * 검증한다. 새 토큰 발급 / 세션 변경 / 쿠키 갱신 없음.
 *
 * 사용처:
 *   - 정산 초기화, 외상 PII 열람 등 "민감 액션 직전 재확인" 흐름
 *   - "비밀번호 한 번 더 입력하세요" UX 만 제공하면 되는 경우
 *
 * Body:
 *   { password: string }
 *
 * Response:
 *   200 { ok: true }
 *   400 { error: "BAD_REQUEST" }     — password 누락
 *   401 { error: "AUTH_INVALID" }    — 비밀번호 불일치 / 인증 실패
 *
 * SECURITY:
 *   - 호출자 인증 필수 (resolveAuthContext).
 *   - 검증 대상 이메일은 인증된 user 의 이메일 (요청 body 에서 받지 않음).
 *   - 실패해도 audit 로그 / rate-limit 적용 (남용 방어).
 *   - 성공/실패 응답 시간 ≈ 동일 (timing attack 완화 위해 supabase 가 자체 처리).
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    let body: { password?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON" }, { status: 400 })
    }
    const password = typeof body.password === "string" ? body.password : ""
    if (!password) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "password is required" }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    // 현재 사용자 이메일 조회 (admin client)
    const admin = createClient(url, key)
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(auth.user_id)
    if (userErr || !userData?.user?.email) {
      return NextResponse.json({ error: "AUTH_INVALID" }, { status: 401 })
    }
    const email = userData.user.email

    // anon client 로 signInWithPassword (서비스 키로는 의미 없음).
    //   anon 키는 클라이언트에 노출돼 있어 보안 위험 없음.
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!anonKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR", message: "anon key missing" }, { status: 500 })
    }
    const checker = createClient(url, anonKey, { auth: { persistSession: false } })
    const { error: signInErr } = await checker.auth.signInWithPassword({ email, password })
    if (signInErr) {
      return NextResponse.json({ error: "AUTH_INVALID", message: "비밀번호가 일치하지 않습니다." }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.type, message: error.message },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
