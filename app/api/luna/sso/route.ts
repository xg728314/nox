import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// NOX → LUNA(커뮤니티) 자동로그인 브리지.
// 로그인된 NOX 사용자의 access token 을 1회용 코드(luna_sso_codes, 같은 DB)로
// 간접화해 LUNA 로 넘긴다. 토큰이 URL 에 직접 노출되지 않음.
// LUNA 쪽 소비 라우트: /api/auth/sso (60초 TTL · 1회 사용).

const LUNA_URL = process.env.LUNA_URL ?? "http://localhost:3100"
const ALLOWED_NEXT = new Set(["/", "/community", "/talk", "/jobs", "/places", "/menu"])

export async function GET(req: NextRequest) {
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/"
  const dest = ALLOWED_NEXT.has(nextParam) ? nextParam : "/"

  const token = req.cookies.get("nox_access_token")?.value
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error("[luna-sso] env missing")
    return NextResponse.redirect(new URL("/m/me", req.url))
  }
  const admin = createClient(supabaseUrl, serviceKey)

  // 토큰이 유효할 때만 코드 발급 (죽은 토큰을 루나로 넘기지 않음)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  // 만료 코드 청소 (best-effort) 후 1회용 코드 발급
  await admin
    .from("luna_sso_codes")
    .delete()
    .lt("created_at", new Date(Date.now() - 5 * 60_000).toISOString())

  const { data: row, error: insErr } = await admin
    .from("luna_sso_codes")
    .insert({ user_id: data.user.id, access_token: token })
    .select("code")
    .single()
  if (insErr || !row) {
    console.error("[luna-sso] code issue failed", insErr)
    return NextResponse.redirect(new URL("/m/me", req.url))
  }

  return NextResponse.redirect(
    `${LUNA_URL}/api/auth/sso?code=${row.code}&next=${encodeURIComponent(dest)}`
  )
}
