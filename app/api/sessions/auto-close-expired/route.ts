/**
 * POST/GET /api/sessions/auto-close-expired
 *
 * 시간 초과 +10분 자동 세션 종료.
 *   - active session_participants 중 (entered_at + time_minutes + 10분) < now
 *     → status='left', left_at=now, memo='AUTO_CLOSE_OVERDUE'
 *   - 모든 참여자가 left 이면 room_sessions 도 status='closed', ended_at=now
 *   - 최근 30분 내 자동 종료된 식구 목록 같이 반환 → 홈 배너 표시용
 *
 * 인증: 다중 방식.
 *   1. cron: Authorization: Bearer <CRON_SECRET>
 *   2. 일반 사용자: 쿠키 기반 (resolveAuthContext) — 본인이 호출해도 안전 (멱등).
 *
 * 응답:
 *   {
 *     ok: true,
 *     closed_now: [{ participant_id, membership_id, hostess_name, store_name, overdue_minutes }],
 *     recently_closed: [{ ... left_at }],  // last 30 min — 배너 표시용
 *   }
 */
import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

const MEMO_TAG = "AUTO_CLOSE_OVERDUE"
const OVERDUE_MINUTES = 10
const RECENT_WINDOW_MIN = 30

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

async function checkAuth(request: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // Cron secret 우선
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  if (cronSecret && verifyBearer(authHeader, cronSecret)) return { ok: true }
  // 일반 user auth
  try {
    await resolveAuthContext(request)
    return { ok: true }
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, status: e.status, error: e.type }
    return { ok: false, status: 401, error: "UNAUTHORIZED" }
  }
}

async function runAutoClose(supabase: SupabaseClient): Promise<{
  closed_now: Array<{ participant_id: string; membership_id: string; hostess_name: string; store_name: string; overdue_minutes: number; left_at: string }>
  closed_sessions: string[]
}> {
  const now = new Date()
  const nowIso = now.toISOString()

  // 1. active session_participants — 부모 session 도 active.
  //    expr (entered_at + time_minutes + 10) < now 조건은 클라이언트 필터.
  //    부모 session status 도 별도 쿼리 (FK 관계 없는 join 회피).
  const { data: candidates, error: qErr } = await supabase
    .from("session_participants")
    .select("id, membership_id, session_id, store_uuid, category, time_minutes, entered_at")
    .eq("status", "active")
    .is("deleted_at", null)
    .not("time_minutes", "is", null)
    .not("entered_at", "is", null)
    .limit(1000)

  if (qErr) throw new Error(`auto-close candidates query: ${qErr.message}`)

  type Row = {
    id: string
    membership_id: string
    session_id: string
    store_uuid: string
    category: string | null
    time_minutes: number
    entered_at: string
  }
  const rows = (candidates ?? []) as Row[]
  if (rows.length === 0) return { closed_now: [], closed_sessions: [] }

  // 부모 session status 매핑
  const sessionIds = Array.from(new Set(rows.map((r) => r.session_id)))
  const sessionStatusMap = new Map<string, string>()
  {
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, status")
      .in("id", sessionIds)
    for (const s of ((sessions ?? []) as { id: string; status: string }[])) {
      sessionStatusMap.set(s.id, s.status)
    }
  }

  const overdueRows: Array<{ p: Row; overdueMinutes: number; orphan: boolean }> = []
  for (const c of rows) {
    const parentStatus = sessionStatusMap.get(c.session_id)
    const enteredMs = new Date(c.entered_at).getTime()
    if (Number.isNaN(enteredMs)) continue
    const endMs = enteredMs + c.time_minutes * 60_000
    const overdueMs = now.getTime() - endMs
    const overdueMin = Math.floor(overdueMs / 60_000)
    // 케이스 A — parent active + 10분 초과 → 정상 자동 종료 대상
    // 케이스 B — parent closed/cancelled + part active = orphan → 즉시 정리
    if (parentStatus === "active" && overdueMin >= OVERDUE_MINUTES) {
      overdueRows.push({ p: c, overdueMinutes: overdueMin, orphan: false })
    } else if (parentStatus && parentStatus !== "active") {
      overdueRows.push({ p: c, overdueMinutes: Math.max(0, overdueMin), orphan: true })
    }
  }

  if (overdueRows.length === 0) {
    return { closed_now: [], closed_sessions: [] }
  }

  // 2. 일괄 update — participants status='left', memo='AUTO_CLOSE_OVERDUE'
  const ids = overdueRows.map((r) => r.p.id)
  const { error: upErr } = await supabase
    .from("session_participants")
    .update({ status: "left", left_at: nowIso, memo: MEMO_TAG })
    .in("id", ids)
  if (upErr) throw new Error(`bulk update participants: ${upErr.message}`)

  // 3. 영향 받은 session 별로 active 참여자 0 이면 session 도 closed
  const affectedSessionIds = Array.from(new Set(overdueRows.map((r) => r.p.session_id)))
  const closedSessions: string[] = []
  for (const sid of affectedSessionIds) {
    const { count } = await supabase
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sid)
      .eq("status", "active")
      .is("deleted_at", null)
    if ((count ?? 0) === 0) {
      const { error: sErr } = await supabase
        .from("room_sessions")
        .update({ status: "closed", ended_at: nowIso })
        .eq("id", sid)
        .eq("status", "active") // race guard
      if (!sErr) closedSessions.push(sid)
    }
  }

  // 4. hostess + store 이름 매핑 (별도 쿼리 — FK 없음)
  const memberships = Array.from(new Set(overdueRows.map((r) => r.p.membership_id)))
  const stores = Array.from(new Set(overdueRows.map((r) => r.p.store_uuid)))
  const hostessNameMap = new Map<string, string>()
  const storeNameMap = new Map<string, string>()
  if (memberships.length > 0) {
    const { data: hs } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .in("membership_id", memberships)
    for (const h of ((hs ?? []) as { membership_id: string; name: string }[])) {
      hostessNameMap.set(h.membership_id, h.name)
    }
  }
  if (stores.length > 0) {
    const { data: ss } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", stores)
    for (const s of ((ss ?? []) as { id: string; store_name: string }[])) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  const closed_now = overdueRows.map((r) => ({
    participant_id: r.p.id,
    membership_id: r.p.membership_id,
    hostess_name: hostessNameMap.get(r.p.membership_id) ?? "?",
    store_name: storeNameMap.get(r.p.store_uuid) ?? "?",
    overdue_minutes: r.overdueMinutes,
    left_at: nowIso,
  }))
  return { closed_now, closed_sessions: closedSessions }
}

async function fetchRecentlyClosed(supabase: SupabaseClient, sinceIso: string) {
  const { data } = await supabase
    .from("session_participants")
    .select("id, membership_id, store_uuid, time_minutes, entered_at, left_at")
    .eq("memo", MEMO_TAG)
    .eq("status", "left")
    .gte("left_at", sinceIso)
    .order("left_at", { ascending: false })
    .limit(50)

  type Row = {
    id: string
    membership_id: string
    store_uuid: string
    time_minutes: number | null
    entered_at: string
    left_at: string
  }
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return []

  // 이름 매핑 별도 쿼리
  const memberships = Array.from(new Set(rows.map((r) => r.membership_id)))
  const stores = Array.from(new Set(rows.map((r) => r.store_uuid)))
  const hostessNameMap = new Map<string, string>()
  const storeNameMap = new Map<string, string>()
  {
    const { data: hs } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .in("membership_id", memberships)
    for (const h of ((hs ?? []) as { membership_id: string; name: string }[])) {
      hostessNameMap.set(h.membership_id, h.name)
    }
  }
  {
    const { data: ss } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", stores)
    for (const s of ((ss ?? []) as { id: string; store_name: string }[])) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  return rows.map((r) => {
    let overdueMin: number | null = null
    if (r.entered_at && r.time_minutes != null && r.left_at) {
      const endMs = new Date(r.entered_at).getTime() + r.time_minutes * 60_000
      const leftMs = new Date(r.left_at).getTime()
      overdueMin = Math.max(0, Math.floor((leftMs - endMs) / 60_000))
    }
    return {
      participant_id: r.id,
      membership_id: r.membership_id,
      hostess_name: hostessNameMap.get(r.membership_id) ?? "?",
      store_name: storeNameMap.get(r.store_uuid) ?? "?",
      overdue_minutes: overdueMin ?? 0,
      left_at: r.left_at,
    }
  })
}

export async function POST(request: Request) {
  return handle(request)
}
export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const auth = await checkAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }
  try {
    const { closed_now, closed_sessions } = await runAutoClose(supabase)
    const sinceIso = new Date(Date.now() - RECENT_WINDOW_MIN * 60_000).toISOString()
    const recently_closed = await fetchRecentlyClosed(supabase, sinceIso)
    return NextResponse.json({
      ok: true,
      closed_now,
      closed_sessions,
      recently_closed,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
