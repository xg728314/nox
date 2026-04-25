import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"

/**
 * GET /api/cron/ble-history-reaper
 *
 * Phase 7 — BLE history retention cron.
 *
 * Purpose:
 *   `ble_presence_history` (created in 056) is an append-only trail of
 *   BLE presence events. Retention policy: 30 days. Older rows are
 *   reaped by this cron.
 *
 * Scheduling strategy:
 *   - vercel.json triggers this endpoint EVERY HOUR (`0 * * * *`).
 *   - The endpoint itself inspects the current hour in the
 *     configured timezone (default Asia/Seoul) and SKIPS deletion
 *     unless `currentHour === CRON_EXEC_HOUR` (default 3 = 03:00 KST).
 *   - This keeps scheduling logic in application code — the schedule
 *     can be retimed by changing an env var, without touching vercel.json.
 *
 * Security:
 *   - Accepts either:
 *       * `Authorization: Bearer <CRON_SECRET>` (timing-safe compare)
 *       * `user-agent` header containing `vercel-cron` (Vercel's own
 *         cron invoker — always internal)
 *   - Either alone is sufficient. Neither → 401.
 *
 * Side effects:
 *   - When executing:  DELETE FROM ble_presence_history
 *                        WHERE seen_at < (now() - interval '30 days')
 *   - When skipping:   no DB write.
 *
 * Return shape:
 *   { ok: true, skipped: true,  reason, executedAt, currentHour, targetHour, tz }
 *   { ok: true, skipped: false, deleted, cutoff, executedAt, currentHour, targetHour, tz }
 *   { ok: false, error, message? }                                  (401 / 500)
 *
 * This route writes to `ble_presence_history` ONLY. It never touches
 * `ble_tag_presence`, `location_correction_logs`, or any other table.
 */

// Vercel Cron + timingSafeEqual + Intl.DateTimeFormat all require the
// Node.js runtime. Edge runtime lacks `node:crypto`.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_EXEC_HOUR = 3             // 03:00 in the configured TZ
const DEFAULT_TZ = "Asia/Seoul"
const RETENTION_DAYS = 30

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Resolve current hour (0-23) in the given IANA timezone.
 * Uses Intl.DateTimeFormat — timezone-safe and no external deps.
 */
function currentHourInTz(tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date())
  const hourPart = parts.find(p => p.type === "hour")
  const raw = parseInt(hourPart?.value ?? "0", 10)
  if (!Number.isFinite(raw)) return 0
  // Some runtimes return "24" at midnight — normalize to 0.
  return raw >= 24 ? 0 : raw < 0 ? 0 : raw
}

/**
 * Verify Bearer token against CRON_SECRET using a timing-safe compare.
 * Returns true iff the token matches.
 */
function verifyBearer(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false
  const prefix = "Bearer "
  if (!authHeader.startsWith(prefix)) return false
  const provided = authHeader.slice(prefix.length).trim()
  if (!provided) return false
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(secret, "utf8")
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

function verifyVercelCronUA(ua: string | null): boolean {
  // Vercel Cron invocations carry `user-agent: vercel-cron/1.0`.
  return !!ua && /vercel-cron/i.test(ua)
}

export async function GET(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  const uaHeader = request.headers.get("user-agent")

  const bearerOk = cronSecret !== "" && verifyBearer(authHeader, cronSecret)
  const uaOk = verifyVercelCronUA(uaHeader)

  if (!bearerOk && !uaOk) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    )
  }

  // ── 2. Time window gate ──────────────────────────────────────────
  const tz = process.env.CRON_TIMEZONE || DEFAULT_TZ
  const targetHourRaw = process.env.CRON_EXEC_HOUR
  const parsedTarget =
    targetHourRaw != null && targetHourRaw !== ""
      ? parseInt(targetHourRaw, 10)
      : DEFAULT_EXEC_HOUR
  const targetHour =
    Number.isInteger(parsedTarget) && parsedTarget >= 0 && parsedTarget <= 23
      ? parsedTarget
      : DEFAULT_EXEC_HOUR

  const currentHour = currentHourInTz(tz)
  const executedAt = new Date().toISOString()

  if (currentHour !== targetHour) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `current_hour=${currentHour} !== target_hour=${targetHour} (tz=${tz})`,
      executedAt,
      currentHour,
      targetHour,
      tz,
    })
  }

  // ── 3. Delete rows older than RETENTION_DAYS ─────────────────────
  let supabase: SupabaseClient
  try {
    supabase = supa()
  } catch {
    return NextResponse.json(
      { ok: false, error: "SERVER_CONFIG_ERROR" },
      { status: 500 },
    )
  }

  // R24: heartbeat. 일 1회 실행되는 cron 이라 stale 임계치 26시간.
  await stampCronHeartbeat(supabase, "ble-history-reaper", "started")

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from("ble_presence_history")
    .delete({ count: "exact" })
    .lt("seen_at", cutoff)

  if (error) {
    return NextResponse.json(
      { ok: false, error: "DELETE_FAILED", message: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    skipped: false,
    deleted: count ?? 0,
    cutoff,
    executedAt,
    currentHour,
    targetHour,
    tz,
  })
}
