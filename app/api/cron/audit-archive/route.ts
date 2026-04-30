import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"

/**
 * GET /api/cron/audit-archive
 *
 * R26: audit_events hot → archive 이동.
 *
 * 정책:
 *   - retention 90일 (RETENTION_DAYS).
 *   - 한 번 호출 당 최대 BATCH_SIZE × MAX_BATCHES rows 이동 (cron 타임아웃 회피).
 *   - DB-level RPC `archive_audit_events` 가 INSERT+DELETE 트랜잭션 보장.
 *
 * Schedule: 0 18 * * * UTC = 03:00 KST (배포 후 vercel.json 에 추가).
 *   ble-history-reaper 와 같은 시간대 — DB 부하 낮은 시간 집중.
 *
 * 보안: Bearer CRON_SECRET 또는 vercel-cron UA. 외엔 401.
 *
 * 멱등: archive 테이블 PK conflict 시 DO NOTHING. 두 번 돌아도 무해.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RETENTION_DAYS = 90
const BATCH_SIZE = 5000
const MAX_BATCHES = 20 // 최대 100K rows / call (5K × 20)

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
  // 1. Auth — Bearer CRON_SECRET 단일 조건 (UA 우회 제거, fail-closed)
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  if (!verifyBearer(authHeader, cronSecret)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  // 2. Params
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"
  const retentionParam = parseInt(url.searchParams.get("retention_days") ?? "", 10)
  const retentionDays = Number.isFinite(retentionParam) && retentionParam >= 30
    ? retentionParam
    : RETENTION_DAYS

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  await stampCronHeartbeat(supabase, "audit-archive", "started")

  // 2026-04-30: success/failed phase stamp 추가 — last_success_at 갱신을 위함.
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

    // 3. dry_run: 카운트만 반환
    if (dryRun) {
      const { count } = await supabase
        .from("audit_events")
        .select("*", { count: "exact", head: true })
        .lt("created_at", cutoff)
      await stampCronHeartbeat(supabase, "audit-archive", "success")
      return NextResponse.json({
        ok: true,
        dry_run: true,
        retention_days: retentionDays,
        cutoff,
        candidates: count ?? 0,
      })
    }

    // 4. 배치 반복 — RPC 가 INSERT+DELETE 트랜잭션 보장.
    let totalMoved = 0
    let batchesRun = 0
    const errors: string[] = []

    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await supabase.rpc("archive_audit_events", {
        cutoff_ts: cutoff,
        batch_size: BATCH_SIZE,
      })
      batchesRun++
      if (error) {
        errors.push(error.message)
        break
      }
      const moved = typeof data === "number" ? data : 0
      totalMoved += moved
      if (moved < BATCH_SIZE) break // 더 이상 처리할 row 없음 — 종료
    }

    if (errors.length === 0) {
      await stampCronHeartbeat(supabase, "audit-archive", "success")
    } else {
      await stampCronHeartbeat(supabase, "audit-archive", "failed", errors.join("; ").slice(0, 500))
    }

    return NextResponse.json({
      ok: errors.length === 0,
      dry_run: false,
      retention_days: retentionDays,
      cutoff,
      moved: totalMoved,
      batches_run: batchesRun,
      errors,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await stampCronHeartbeat(supabase, "audit-archive", "failed", msg)
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: msg },
      { status: 500 },
    )
  }
}
