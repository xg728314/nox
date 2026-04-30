import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"
import { cascadeExpiredPaperLedgers } from "@/lib/reconcile/deleteCascade"

/**
 * GET /api/cron/paper-ledger-expire
 *
 * R-Paper-Retention (2026-05-01): 종이장부 사진 자동 만료 cron.
 *
 * 정책:
 *   - paper_ledger_snapshots.expires_at 경과 row 일괄 cascade 삭제.
 *   - 매장별 expires_at 은 upload 시 store_settings.paper_ledger_retention_days
 *     기준으로 자동 set.
 *   - cascade: 사진(Storage) + extractions + edits + diffs + snapshot row.
 *   - 보존: learning_signals (PII auto-hash), store_paper_format.
 *
 * Schedule 권장: 0 19 * * * UTC = 04:00 KST (DB 부하 낮은 시간).
 *
 * 보안: Bearer CRON_SECRET. 외엔 401.
 *
 * 멱등: expires_at 경과만 처리 → 두 번 돌아도 무해.
 *
 * Batch:
 *   기본 BATCH_SIZE=50, MAX_BATCHES=20 → 호출당 최대 1000 snapshots.
 *   cron 타임아웃 (Cloud Run 60s default, Vercel 300s) 안에 안전.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function verifyBearer(authHeader: string | null, secret: string): boolean {
  if (!secret) return false
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false
  const provided = authHeader.slice("Bearer ".length).trim()
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

  let supabase: SupabaseClient
  try {
    supabase = supa()
  } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  await stampCronHeartbeat(supabase, "paper-ledger-expire", "started")

  try {
    if (dryRun) {
      // dry_run: 후보만 카운트
      const cutoff = new Date().toISOString()
      const { count } = await supabase
        .from("paper_ledger_snapshots")
        .select("*", { count: "exact", head: true })
        .not("expires_at", "is", null)
        .lt("expires_at", cutoff)
      await stampCronHeartbeat(supabase, "paper-ledger-expire", "success")
      return NextResponse.json({
        ok: true,
        dry_run: true,
        candidates: count ?? 0,
        cutoff,
      })
    }

    const result = await cascadeExpiredPaperLedgers(supabase, {
      batch_size: 50,
      max_batches: 20,
    })

    await stampCronHeartbeat(supabase, "paper-ledger-expire", "success")

    return NextResponse.json({
      ok: true,
      total_deleted: result.total_deleted,
      total_failed: result.total_failed,
      cutoff: result.cutoff,
      // per_snapshot 상세는 너무 무거워서 생략 (디버그 시에만)
      sample_errors: result.per_snapshot
        .filter((r) => r.errors.length > 0)
        .slice(0, 5)
        .map((r) => ({ id: r.snapshot_id, errors: r.errors })),
    })
  } catch (e) {
    await stampCronHeartbeat(supabase, "paper-ledger-expire", "failed").catch(() => {})
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: (e as Error).message },
      { status: 500 },
    )
  }
}
