import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/cron/ble-attendance-sync
 *
 * ROUND-STAFF-3 — BLE 기반 자동 출근 동기화 (보조 자동화).
 *
 * 원칙:
 *   - BLE 는 **있으면 만들고 없으면 skip** 하는 read-only 보조 로직.
 *   - 수동 출근/퇴근 (/api/attendance POST) 이 항상 우선. 이 cron 은
 *     그 경로를 건드리지 않는다.
 *   - UPDATE / DELETE / checkout 절대 하지 않음. checkin INSERT 만.
 *
 * 흐름:
 *   1) ble_presence_history.seen_at > now() - 10m 범위에서
 *      membership_id NOT NULL 행의 고유 (membership_id, store_uuid) 수집.
 *   2) ble_tags.(store_uuid, membership_id, is_active) 로 **tag 소속**
 *      검증 — tag.store_uuid != 감지 store_uuid 면 skip (home != 감지).
 *   3) 해당 store 의 open business_day (status='open', today) 찾기.
 *      없으면 skip (비즈룰: 영업일 자동 생성은 /api/attendance 만 담당).
 *   4) store_memberships.(id, role, status='approved') 확인.
 *      role 추출 (staff_attendance.role 은 NOT NULL).
 *   5) 기존 open 출근 행 (checked_out_at IS NULL) 있으면 skip.
 *   6) 최근 1시간 내 checkout 행 있으면 skip (flaky 재출근 방지).
 *   7) INSERT staff_attendance { role, notes: 'source:ble' }.
 *      UNIQUE(store_uuid, business_day_id, membership_id) partial index
 *      (migration 062) 가 race 를 하드웨어 레벨에서 차단.
 *
 * 멱등:
 *   - 같은 cron 이 2분마다 돌아도 UNIQUE index + application 체크로 멱등.
 *   - dry_run=1 으로 INSERT 없이 카운트만 반환 (Step-1 관찰 모드).
 *
 * 보안:
 *   - Authorization: Bearer <CRON_SECRET> (timingSafeEqual), 또는
 *   - user-agent: vercel-cron/*
 *   외에는 401.
 *
 * 응답 shape:
 *   { ok, dry_run, scanned, checked_in, skipped: {...}, window: {...} }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Locked constants ────────────────────────────────────────────
const SCAN_LOOKBACK_MIN = 10 // BLE presence_history 최근 10분
const REENTRY_BLOCK_MIN = 60 // 최근 checkout 후 1시간 재출근 차단

// ── Auth helpers ────────────────────────────────────────────────
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

type PresenceRow = {
  membership_id: string
  store_uuid: string
  minor: number | null
}

type Skip = {
  tag_missing: number         // ble_tags 에 (store_uuid, membership_id) 없음
  tag_store_mismatch: number  // tag.store_uuid != presence_history.store_uuid
  membership_not_approved: number
  no_open_business_day: number
  already_checked_in: number
  recent_checkout_block: number
  unique_conflict: number     // UNIQUE(open) 위반 (race)
  insert_failed: number
}

export async function GET(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  const uaHeader = request.headers.get("user-agent")
  if (!verifyBearer(authHeader, cronSecret) && !verifyVercelCronUA(uaHeader)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  // ── 2. Params ────────────────────────────────────────────
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // R24: heartbeat — cron 이 실제로 실행됐다는 흔적. 실패해도 cron 본체에 영향 없음.
  await stampCronHeartbeat(supabase, "ble-attendance-sync", "started")

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const windowStartIso = new Date(nowMs - SCAN_LOOKBACK_MIN * 60 * 1000).toISOString()

  const skipped: Skip = {
    tag_missing: 0,
    tag_store_mismatch: 0,
    membership_not_approved: 0,
    no_open_business_day: 0,
    already_checked_in: 0,
    recent_checkout_block: 0,
    unique_conflict: 0,
    insert_failed: 0,
  }
  let scanned = 0
  let checkedIn = 0

  // ── 3. Scan recent presence ──────────────────────────────
  const { data: presRaw, error: presErr } = await supabase
    .from("ble_presence_history")
    .select("membership_id, store_uuid, minor")
    .gte("seen_at", windowStartIso)
    .lte("seen_at", nowIso)
    .not("membership_id", "is", null)
    .limit(5000)

  if (presErr) {
    return NextResponse.json(
      { ok: false, error: "PRESENCE_SCAN_FAILED", message: presErr.message },
      { status: 500 },
    )
  }

  // Dedup: (membership_id, store_uuid) 쌍으로 축약
  const seen = new Map<string, PresenceRow>()
  for (const r of ((presRaw ?? []) as PresenceRow[])) {
    if (!r.membership_id || !r.store_uuid) continue
    const key = `${r.membership_id}__${r.store_uuid}`
    if (!seen.has(key)) seen.set(key, r)
  }
  scanned = seen.size

  if (seen.size === 0) {
    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      scanned: 0,
      checked_in: 0,
      skipped,
      window: { from: windowStartIso, to: nowIso },
    })
  }

  // ── 4. Preload tags / memberships / business days in batch ──
  const membershipIds = Array.from(new Set([...seen.values()].map((r) => r.membership_id)))
  const storeIds = Array.from(new Set([...seen.values()].map((r) => r.store_uuid)))

  // ble_tags — home store 검증용
  const { data: tagRows } = await supabase
    .from("ble_tags")
    .select("store_uuid, membership_id, is_active")
    .in("membership_id", membershipIds)
    .eq("is_active", true)
  type TagRow = { store_uuid: string; membership_id: string; is_active: boolean }
  const tagByKey = new Map<string, TagRow>() // `${membership_id}__${store_uuid}`
  for (const t of (tagRows ?? []) as TagRow[]) {
    tagByKey.set(`${t.membership_id}__${t.store_uuid}`, t)
  }

  // store_memberships — role 추출 + approved 검증
  const { data: memRows } = await supabase
    .from("store_memberships")
    .select("id, store_uuid, role, status")
    .in("id", membershipIds)
    .in("store_uuid", storeIds)
    .eq("status", "approved")
    .is("deleted_at", null)
  type MemRow = { id: string; store_uuid: string; role: string; status: string }
  const memByKey = new Map<string, MemRow>() // `${id}__${store_uuid}`
  for (const m of (memRows ?? []) as MemRow[]) {
    memByKey.set(`${m.id}__${m.store_uuid}`, m)
  }

  // open business_day per store (오늘 + status='open')
  const today = getBusinessDateForOps()
  const { data: dayRows } = await supabase
    .from("store_operating_days")
    .select("id, store_uuid")
    .in("store_uuid", storeIds)
    .eq("business_date", today)
    .eq("status", "open")
    .is("deleted_at", null)
  type DayRow = { id: string; store_uuid: string }
  const dayByStore = new Map<string, string>()
  for (const d of (dayRows ?? []) as DayRow[]) {
    dayByStore.set(d.store_uuid, d.id)
  }

  // ── 5. Process each unique (membership, store) ───────────
  const recentCutoff = new Date(nowMs - REENTRY_BLOCK_MIN * 60 * 1000).toISOString()

  for (const row of seen.values()) {
    // 5.1 tag existence + store match (rule D: store mismatch 금지)
    const tag = tagByKey.get(`${row.membership_id}__${row.store_uuid}`)
    if (!tag) {
      // tag 가 없거나 다른 store 로 등록됨 → skip
      // 추가 확인: 다른 매장에 tag 가 있으면 tag_store_mismatch, 아니면 tag_missing
      const anyOther = (tagRows ?? []).some(
        (t: TagRow) => t.membership_id === row.membership_id,
      )
      if (anyOther) skipped.tag_store_mismatch += 1
      else skipped.tag_missing += 1
      continue
    }

    // 5.2 store membership (role 확보)
    const mem = memByKey.get(`${row.membership_id}__${row.store_uuid}`)
    if (!mem) {
      skipped.membership_not_approved += 1
      continue
    }

    // 5.3 open business_day
    const businessDayId = dayByStore.get(row.store_uuid)
    if (!businessDayId) {
      skipped.no_open_business_day += 1
      continue
    }

    // 5.4 기존 open 출근 (application-layer check, DB UNIQUE 보조)
    const { data: existing } = await supabase
      .from("staff_attendance")
      .select("id")
      .eq("store_uuid", row.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("membership_id", row.membership_id)
      .is("checked_out_at", null)
      .limit(1)
    if (existing && existing.length > 0) {
      skipped.already_checked_in += 1
      continue
    }

    // 5.5 최근 1시간 내 퇴근 행 있으면 skip (flaky 재출근 차단)
    const { data: recentOut } = await supabase
      .from("staff_attendance")
      .select("id")
      .eq("store_uuid", row.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("membership_id", row.membership_id)
      .not("checked_out_at", "is", null)
      .gte("checked_out_at", recentCutoff)
      .limit(1)
    if (recentOut && recentOut.length > 0) {
      skipped.recent_checkout_block += 1
      continue
    }

    // 5.6 INSERT (또는 dry_run 이면 카운터만)
    if (dryRun) {
      checkedIn += 1
      continue
    }

    const { error: insErr } = await supabase
      .from("staff_attendance")
      .insert({
        store_uuid: row.store_uuid,
        business_day_id: businessDayId,
        membership_id: row.membership_id,
        role: mem.role,
        status: "available",
        notes: "source:ble",
        // checked_in_at = DEFAULT now()
      })

    if (insErr) {
      // 23505 = unique_violation → 다른 프로세스가 방금 INSERT
      const code = (insErr as { code?: string }).code
      if (code === "23505") {
        skipped.unique_conflict += 1
      } else {
        skipped.insert_failed += 1
      }
      continue
    }
    checkedIn += 1
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    scanned,
    checked_in: checkedIn,
    skipped,
    window: { from: windowStartIso, to: nowIso },
  })
}
