import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/admin/deployments
 *
 * R-Ver Phase 2: deployment_events 통계 + 목록.
 *
 * 권한: owner only (배포 정보는 운영 메타라 매장 무관).
 *
 * 응답:
 *   {
 *     today_count: number,           // 오늘 KST 기준 배포 수
 *     last_24h_count: number,
 *     last_7d_count: number,
 *     items: [{ revision, git_short_sha, git_message, first_seen_at, ... }]
 *   }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** KST 기준 오늘 00:00 ISO. */
function kstTodayStartIso(): string {
  const now = new Date()
  // KST = UTC+9
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000)
  const y = kstNow.getUTCFullYear()
  const m = String(kstNow.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kstNow.getUTCDate()).padStart(2, "0")
  // KST 자정 = UTC 전날 15:00
  return `${y}-${m}-${d}T00:00:00+09:00`
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner only" }, { status: 403 })
    }

    const supabase = supa()
    const url = new URL(request.url)
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50))

    const todayStart = kstTodayStartIso()
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

    const [{ count: todayCount }, { count: dayCount }, { count: weekCount }, { data: items }] = await Promise.all([
      supabase.from("deployment_events").select("*", { count: "exact", head: true }).gte("first_seen_at", todayStart),
      supabase.from("deployment_events").select("*", { count: "exact", head: true }).gte("first_seen_at", dayAgo),
      supabase.from("deployment_events").select("*", { count: "exact", head: true }).gte("first_seen_at", weekAgo),
      supabase.from("deployment_events")
        .select("id, revision, service, region, git_sha, git_short_sha, git_message, built_at, first_seen_at, build_id")
        .order("first_seen_at", { ascending: false })
        .limit(limit),
    ])

    return NextResponse.json({
      today_count: todayCount ?? 0,
      last_24h_count: dayCount ?? 0,
      last_7d_count: weekCount ?? 0,
      items: items ?? [],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
