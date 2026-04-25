import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"

/**
 * GET /api/cron/settlement-tree-advance
 *
 * R29: 정산 트리 3단계 자동 진행/삭제.
 *   매일 17:00 KST (08:00 UTC) 실행.
 *
 * 단계 규칙 (사용자 정책):
 *   Stage 1 → Stage 2: stage_advanced_at 이 1일 이상 경과
 *   Stage 2 → Stage 3: stage_advanced_at 이 2일 이상 경과
 *   Stage 3 → soft delete: stage_advanced_at 이 3일 이상 경과
 *   remaining_amount = 0 → soft delete (단계 무관)
 *
 * 보안:
 *   - Authorization: Bearer <CRON_SECRET> (timingSafeEqual)
 *   - user-agent: vercel-cron/*
 *   외엔 401.
 *
 * 멱등: 같은 시점 재실행 시 stage_advanced_at 비교라 중복 진행 안 됨.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SECONDS = 1000
const MINUTES = 60 * SECONDS
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS

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
function verifyVercelCronUA(ua: string | null): boolean {
  return !!ua && /vercel-cron/i.test(ua)
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
  const uaHeader = request.headers.get("user-agent")
  if (!verifyBearer(authHeader, cronSecret) && !verifyVercelCronUA(uaHeader)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  await stampCronHeartbeat(supabase, "settlement-tree-advance", "started")

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 1 * DAYS).toISOString()
  const twoDaysAgo = new Date(now.getTime() - 2 * DAYS).toISOString()
  const threeDaysAgo = new Date(now.getTime() - 3 * DAYS).toISOString()
  const nowIso = now.toISOString()

  type StepResult = { name: string; affected: number; error?: string }
  const results: StepResult[] = []

  async function step(
    name: string,
    op: () => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>,
  ) {
    if (dryRun) { results.push({ name, affected: 0 }); return }
    const r = await op()
    if (r.error) {
      // migration 097 미적용이면 42703 → 모든 step 실패. 첫 error 만 기록.
      results.push({ name, affected: 0, error: r.error.message })
      return
    }
    const arr = Array.isArray(r.data) ? r.data : []
    results.push({ name, affected: arr.length })
  }

  // 1) Stage 1 → Stage 2 (1일 이상 경과)
  await step("stage_1_to_2", async () => {
    return await supabase
      .from("cross_store_settlements")
      .update({ tree_stage: 2, stage_advanced_at: nowIso })
      .eq("tree_stage", 1)
      .lt("stage_advanced_at", oneDayAgo)
      .is("deleted_at", null)
      .select("id")
  })

  // 2) Stage 2 → Stage 3 (2일 이상 경과)
  await step("stage_2_to_3", async () => {
    return await supabase
      .from("cross_store_settlements")
      .update({ tree_stage: 3, stage_advanced_at: nowIso })
      .eq("tree_stage", 2)
      .lt("stage_advanced_at", twoDaysAgo)
      .is("deleted_at", null)
      .select("id")
  })

  // 3) Stage 3 → soft delete (3일 이상 경과)
  await step("stage_3_expired", async () => {
    return await supabase
      .from("cross_store_settlements")
      .update({ deleted_at: nowIso })
      .eq("tree_stage", 3)
      .lt("stage_advanced_at", threeDaysAgo)
      .is("deleted_at", null)
      .select("id")
  })

  // 4) remaining_amount = 0 (정산 완료) → 즉시 soft delete
  await step("settled_paid", async () => {
    return await supabase
      .from("cross_store_settlements")
      .update({ deleted_at: nowIso })
      .eq("remaining_amount", 0)
      .is("deleted_at", null)
      .select("id")
  })

  // 5) items 단계도 동일하게 진행 (혹시 header 와 어긋나는 경우 보정)
  //    items 는 header tree_stage 따라가는 게 정상. 분리해서 단계 advance 도 함.
  await step("items_stage_1_to_2", async () => {
    return await supabase
      .from("cross_store_settlement_items")
      .update({ tree_stage: 2, stage_advanced_at: nowIso })
      .eq("tree_stage", 1)
      .lt("stage_advanced_at", oneDayAgo)
      .is("deleted_at", null)
      .select("id")
  })
  await step("items_stage_2_to_3", async () => {
    return await supabase
      .from("cross_store_settlement_items")
      .update({ tree_stage: 3, stage_advanced_at: nowIso })
      .eq("tree_stage", 2)
      .lt("stage_advanced_at", twoDaysAgo)
      .is("deleted_at", null)
      .select("id")
  })
  await step("items_stage_3_expired", async () => {
    return await supabase
      .from("cross_store_settlement_items")
      .update({ deleted_at: nowIso })
      .eq("tree_stage", 3)
      .lt("stage_advanced_at", threeDaysAgo)
      .is("deleted_at", null)
      .select("id")
  })

  return NextResponse.json({
    ok: results.every(r => !r.error),
    dry_run: dryRun,
    now: nowIso,
    results,
  })
}
