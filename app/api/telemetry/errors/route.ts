import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/telemetry/errors?hours=24&status=active
 *
 *   owner 만. 본인 매장 + 익명(store null) 에러를 (tag, error_name, error_message)
 *   기준으로 그룹핑해서 반환. count / first_seen / last_seen 으로 "지금도 발생 중"
 *   vs "과거에만 발생" 을 구분 가능.
 *
 *   Query params:
 *     hours   : 조회 윈도우. 1~168 (기본 24).
 *     status  : "active" (resolved_at IS NULL, 기본) | "resolved" | "all"
 *
 *   Response:
 *     { hours, status, total, groups: [...], tag_summary: [...] }
 *
 *   group shape:
 *     { fingerprint, tag, error_name, error_message,
 *       count, first_seen, last_seen, last_url,
 *       sample_id, sample_stack, sample_extra, sample_actor_role,
 *       sample_user_agent, sample_digest, resolved_at }
 *
 *   2026-04-28 (R-system-errors-resolve): 그룹핑 + status 필터 도입.
 *   기존 응답의 `errors` 배열은 backwards-compat 위해 유지하되, UI 는
 *   `groups` 만 사용하도록 갱신.
 */

type Row = {
  id: string
  store_uuid: string | null
  actor_role: string | null
  tag: string | null
  error_name: string | null
  error_message: string | null
  stack: string | null
  digest: string | null
  url: string | null
  user_agent: string | null
  extra: Record<string, unknown> | null
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

function fingerprint(r: Row): string {
  // tag + error_name + first 500 chars of error_message. md5 클라/서버 동일 hash.
  const parts = [
    r.tag ?? "",
    r.error_name ?? "",
    (r.error_message ?? "").slice(0, 500),
  ]
  // 간단한 djb2 해시 — 서버 사이드 group key. md5 까지 갈 필요 없음.
  let h = 5381
  const s = parts.join("|")
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN" },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? 24)))
    const status = (url.searchParams.get("status") ?? "active") as "active" | "resolved" | "all"
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let query = supabase
      .from("system_errors")
      .select("id, store_uuid, actor_role, tag, error_name, error_message, stack, digest, url, user_agent, extra, created_at, resolved_at, resolved_by")
      .or(`store_uuid.eq.${auth.store_uuid},store_uuid.is.null`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000)

    if (status === "active") {
      query = query.is("resolved_at", null)
    } else if (status === "resolved") {
      query = query.not("resolved_at", "is", null)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    const rows = (data ?? []) as Row[]

    // 그룹핑: fingerprint(tag, error_name, error_message) 기준.
    type Group = {
      fingerprint: string
      tag: string | null
      error_name: string | null
      error_message: string | null
      count: number
      first_seen: string
      last_seen: string
      last_url: string | null
      sample_id: string
      sample_stack: string | null
      sample_extra: Record<string, unknown> | null
      sample_actor_role: string | null
      sample_user_agent: string | null
      sample_digest: string | null
      // 그룹 내에 미해결 행이 하나라도 있으면 active 로 본다.
      // 모두 resolved 인 경우만 resolved_at 표시.
      resolved_at: string | null
    }
    const groups = new Map<string, Group>()
    for (const r of rows) {
      const fp = fingerprint(r)
      const g = groups.get(fp)
      if (!g) {
        groups.set(fp, {
          fingerprint: fp,
          tag: r.tag,
          error_name: r.error_name,
          error_message: r.error_message,
          count: 1,
          first_seen: r.created_at,
          last_seen: r.created_at,
          last_url: r.url,
          sample_id: r.id,
          sample_stack: r.stack,
          sample_extra: r.extra,
          sample_actor_role: r.actor_role,
          sample_user_agent: r.user_agent,
          sample_digest: r.digest,
          resolved_at: r.resolved_at,
        })
      } else {
        g.count += 1
        // rows 는 created_at DESC 정렬이라 first/last 갱신 시 비교 필요.
        if (r.created_at < g.first_seen) g.first_seen = r.created_at
        if (r.created_at > g.last_seen) {
          g.last_seen = r.created_at
          g.last_url = r.url
        }
        // active 행이 하나라도 있으면 그룹은 active.
        if (!r.resolved_at) {
          g.resolved_at = null
        } else if (g.resolved_at && r.resolved_at > g.resolved_at) {
          g.resolved_at = r.resolved_at
        }
      }
    }
    const groupArr = [...groups.values()].sort((a, b) =>
      a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0,
    )

    // 태그별 집계 (UI 헤더 batch).
    const tagCounts = new Map<string, number>()
    for (const row of rows) {
      const t = (row.tag as string) || "(untagged)"
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
    const tagSummary = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      hours,
      status,
      total: rows.length,
      groups: groupArr,
      tag_summary: tagSummary,
      // legacy field — 신규 UI 는 groups 사용.
      errors: rows.slice(0, 500),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
