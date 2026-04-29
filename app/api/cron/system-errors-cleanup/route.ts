import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"

/**
 * GET /api/cron/system-errors-cleanup
 *
 *   2026-04-28 (R-system-errors-resolve):
 *
 *   시스템 에러 모니터의 두 가지 운영 부담을 자동화한다.
 *
 *   (a) Auto-resolve stale: 같은 fingerprint(tag, error_name, error_message)
 *       묶음의 마지막 발생 시각이 STALE_AFTER_HOURS (기본 6h) 보다 오래되면
 *       resolved_at = now() 로 stamp. 즉 "최근에 안 보이는 에러" 는 자동 해결.
 *       owner 가 수동으로 dismiss 안 해도 모니터에서 사라짐.
 *
 *   (b) Hard-delete old resolved: resolved_at < now() - DELETE_AFTER_DAYS
 *       (기본 30d) 인 행은 영구 삭제. 무한 누적 방지.
 *
 *   Schedule (운영 권장): 매시간. Vercel Hobby 1일 1회 제약 시 새벽 1회.
 *
 *   Idempotent: 같은 row 에 대해 두 번 update 해도 의미 동일 (resolved_at
 *   덮어써지지만 값 차이 무시할 수준). delete 도 두 번 안전.
 *
 *   Auth: Bearer CRON_SECRET (다른 cron 과 동일 패턴).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STALE_AFTER_HOURS = 6
const DELETE_AFTER_DAYS = 30

function verifyBearer(authHeader: string | null, secret: string): boolean {
  if (!authHeader || !secret) return false
  const prefix = "Bearer "
  if (!authHeader.startsWith(prefix)) return false
  const provided = authHeader.slice(prefix.length).trim()
  if (!provided) return false
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(secret, "utf8")
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  if (!verifyBearer(authHeader, cronSecret)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"
  const staleHoursParam = parseInt(url.searchParams.get("stale_hours") ?? "", 10)
  const staleHours =
    Number.isFinite(staleHoursParam) && staleHoursParam >= 1 ? staleHoursParam : STALE_AFTER_HOURS
  const deleteDaysParam = parseInt(url.searchParams.get("delete_days") ?? "", 10)
  const deleteDays =
    Number.isFinite(deleteDaysParam) && deleteDaysParam >= 7 ? deleteDaysParam : DELETE_AFTER_DAYS

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  await stampCronHeartbeat(supabase, "system-errors-cleanup", "started")

  const staleCutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString()
  const deleteCutoff = new Date(Date.now() - deleteDays * 24 * 60 * 60 * 1000).toISOString()

  // ─── (a) Auto-resolve stale ────────────────────────────────────────
  //
  //   "최근 staleHours 안에 동일 fingerprint 발생 없음" 인 unresolved 행을
  //   resolved 로 일괄 마킹. 단순 SQL 로 처리 (anti-join 패턴).
  //
  //   동일 fingerprint 의 한 행이라도 staleCutoff 이후에 있으면 그 그룹은
  //   "여전히 active" — resolve 하지 않음.
  //
  //   PostgREST 으로는 이 anti-join 을 직접 못 짜므로 RPC 가 가장 깔끔하지만,
  //   추가 RPC 마이그레이션 없이 처리하기 위해 두 단계로 한다:
  //     1) staleCutoff 이전 unresolved 행 모두 후보.
  //     2) 후보 fingerprint 중에 staleCutoff 이후 발생 행이 있으면 제외.
  //   row 수가 수만 단위라 인메모리 처리 가능.

  let autoResolved = 0
  let resolveError: string | null = null

  try {
    const { data: oldRows, error: oldErr } = await supabase
      .from("system_errors")
      .select("id, tag, error_name, error_message, created_at")
      .is("resolved_at", null)
      .lt("created_at", staleCutoff)
      .limit(50000)

    if (oldErr) throw new Error(oldErr.message)

    type Row = { id: string; tag: string | null; error_name: string | null; error_message: string | null }
    const oldByFp = new Map<string, Row[]>()
    function fp(r: { tag: string | null; error_name: string | null; error_message: string | null }) {
      return [
        r.tag ?? "",
        r.error_name ?? "",
        (r.error_message ?? "").slice(0, 500),
      ].join("|")
    }
    for (const r of (oldRows ?? []) as Row[]) {
      const k = fp(r)
      const arr = oldByFp.get(k)
      if (arr) arr.push(r)
      else oldByFp.set(k, [r])
    }

    if (oldByFp.size > 0) {
      // 후보 fingerprint 중 "최근 발생" 있는 그룹 제외.
      const { data: recent, error: recentErr } = await supabase
        .from("system_errors")
        .select("tag, error_name, error_message")
        .gte("created_at", staleCutoff)
        .limit(50000)
      if (recentErr) throw new Error(recentErr.message)

      const recentFps = new Set<string>()
      for (const r of (recent ?? []) as Row[]) recentFps.add(fp(r))

      const toResolveIds: string[] = []
      for (const [k, rows] of oldByFp) {
        if (recentFps.has(k)) continue
        for (const r of rows) toResolveIds.push(r.id)
      }

      if (!dryRun && toResolveIds.length > 0) {
        // 큰 IN 절 회피 — 1000개 청크로 나눠 update.
        const CHUNK = 1000
        for (let i = 0; i < toResolveIds.length; i += CHUNK) {
          const chunk = toResolveIds.slice(i, i + CHUNK)
          const { error: updErr } = await supabase
            .from("system_errors")
            .update({ resolved_at: new Date().toISOString(), resolved_by: null })
            .in("id", chunk)
            .is("resolved_at", null)
          if (updErr) throw new Error(updErr.message)
        }
      }
      autoResolved = toResolveIds.length
    }
  } catch (e) {
    resolveError = e instanceof Error ? e.message : String(e)
  }

  // ─── (b) Hard-delete old resolved ──────────────────────────────────

  let deleted = 0
  let deleteError: string | null = null
  try {
    if (dryRun) {
      const { count } = await supabase
        .from("system_errors")
        .select("*", { count: "exact", head: true })
        .not("resolved_at", "is", null)
        .lt("resolved_at", deleteCutoff)
      deleted = count ?? 0
    } else {
      const { data: toDelete, error: delErr } = await supabase
        .from("system_errors")
        .delete()
        .not("resolved_at", "is", null)
        .lt("resolved_at", deleteCutoff)
        .select("id")
      if (delErr) throw new Error(delErr.message)
      deleted = (toDelete ?? []).length
    }
  } catch (e) {
    deleteError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({
    ok: !resolveError && !deleteError,
    dry_run: dryRun,
    stale_hours: staleHours,
    delete_days: deleteDays,
    auto_resolved: autoResolved,
    deleted,
    errors: [resolveError, deleteError].filter(Boolean),
  })
}
