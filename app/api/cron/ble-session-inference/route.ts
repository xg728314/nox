import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import {
  inferWorkType as inferWorkTypePure,
  sourceRef as sourceRefPure,
  WINDOW_SEC as WINDOW_SEC_PURE,
  DURATION_MIN_SKIP as DURATION_MIN_SKIP_PURE,
} from "@/lib/server/queries/bleSessionInference"

/**
 * GET /api/cron/ble-session-inference
 *
 * Phase 8 — BLE → staff_work_logs session_inference (cron/worker 모드).
 *
 * 역할:
 *   최근 lookback 윈도우의 ble_ingest_events 를 스캔해 ENTER/EXIT 페어를
 *   staff_work_logs(source='ble', status='draft') 로 materialize 한다.
 *   EXIT 이 오지 않아 열린 채로 남은 draft 는 MAX_OPEN_DURATION 경과
 *   후 reaper 가 자동 종료한다.
 *
 * 절대 금지 (이 라운드 잠금):
 *   - /api/ble/ingest 무수정 (본 route 는 DB 를 읽는 외부 관찰자)
 *   - schema / migration 변경 없음 (staff_work_logs.source/source_ref/ble_event_id
 *     는 migration 059 의 기존 컬럼만 사용)
 *   - aggregate / lifecycle 로직 무수정
 *
 * 보안:
 *   - Authorization: Bearer <CRON_SECRET>  (timingSafeEqual)
 *   - user-agent: vercel-cron/*            (Vercel 내부 invoker)
 *   둘 중 하나만 통과해도 OK. 그 외 → 401.
 *
 * Query:
 *   ?dry_run=1   → INSERT/UPDATE 없이 카운트만 계산. Step-1 관찰 모드.
 *   ?lookback=30 → (선택) 분 단위 재스캔 폭. 기본 30, 최대 180.
 *
 * 응답:
 *   { ok, dry_run, lookback_min, scanned, created, closed, reaped, skipped: {...} }
 *
 * 멱등:
 *   UNIQUE(source, source_ref) partial index `uq_swl_source_ref` 가 두
 *   번째 INSERT 를 차단 (23505). `source_ref` 는 결정론적 포맷이라 재실행
 *   안전.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Locked constants (설계 라운드에서 확정) ─────────────────────
// WINDOW_SEC, DURATION_MIN_SKIP 은 pure helper 파일에서 import (테스트 가능).
const WINDOW_SEC = WINDOW_SEC_PURE
const MAX_OPEN_DURATION_MS = 4 * 60 * 60 * 1000 // 4h reaper 상한
const DEFAULT_MIN = 15 // reaper fallback 지속시간 (분)
const DURATION_MIN_SKIP = DURATION_MIN_SKIP_PURE
const EXIT_TOLERANCE_SEC = 15 // ENTER 후 15초 이내 EXIT 은 debounce skip
const DEFAULT_SCAN_LOOKBACK_MIN = 30
const MAX_SCAN_LOOKBACK_MIN = 180

// ── Auth helpers (ble-history-reaper 와 동일 패턴) ──────────────
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

// ── Types ─────────────────────────────────────────────────────
type BleEvent = {
  id: string
  gateway_id: string
  store_uuid: string | null
  room_uuid: string | null
  beacon_minor: number
  event_type: "enter" | "exit" | "heartbeat"
  observed_at: string
}
type GatewayRow = { gateway_id: string; store_uuid: string; room_uuid: string | null }
type TagRow = { store_uuid: string; minor: number; membership_id: string | null }
type OpenDraft = {
  id: string
  hostess_membership_id: string
  working_store_uuid: string
  working_store_room_uuid: string | null
  started_at: string
  source_ref: string | null
}

type SkipCounters = {
  gateway_unknown: number
  tag_unknown: number
  tag_unassigned: number
  duration_too_short: number
  time_order_invalid: number
  exit_orphan: number
  already_open: number
  unique_conflict: number
  heartbeat_ignored: number
  exit_debounced: number
}

// inferWorkType / sourceRef 은 lib/server/queries/bleSessionInference.ts
// 로 추출되어 있음 — route 에서 별칭으로 호출.
const inferWorkType = inferWorkTypePure
const sourceRef = sourceRefPure

// Audit helper — best-effort, no throw
async function writeAudit(
  supabase: SupabaseClient,
  gateway_id: string,
  store_uuid: string | null,
  error_message: string,
) {
  try {
    await supabase.from("ble_ingest_audit").insert({
      gateway_id,
      store_uuid,
      event_count: 0,
      success: false,
      error_message,
    })
  } catch {
    /* best-effort */
  }
}

export async function GET(request: Request) {
  // ── 1. Auth ────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  const uaHeader = request.headers.get("user-agent")
  if (!verifyBearer(authHeader, cronSecret) && !verifyVercelCronUA(uaHeader)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  }

  // ── 2. Params ──────────────────────────────────────────────
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dry_run") === "1"
  const lookbackRaw = Number(url.searchParams.get("lookback") ?? DEFAULT_SCAN_LOOKBACK_MIN)
  const lookbackMin = Number.isFinite(lookbackRaw)
    ? Math.min(MAX_SCAN_LOOKBACK_MIN, Math.max(1, Math.floor(lookbackRaw)))
    : DEFAULT_SCAN_LOOKBACK_MIN

  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const windowStartIso = new Date(now - lookbackMin * 60 * 1000).toISOString()

  const skipped: SkipCounters = {
    gateway_unknown: 0, tag_unknown: 0, tag_unassigned: 0,
    duration_too_short: 0, time_order_invalid: 0,
    exit_orphan: 0, already_open: 0, unique_conflict: 0,
    heartbeat_ignored: 0, exit_debounced: 0,
  }
  let scanned = 0
  let created = 0
  let closed = 0
  let reaped = 0

  // ── 3. Load events in window ───────────────────────────────
  const { data: eventsRaw, error: evErr } = await supabase
    .from("ble_ingest_events")
    .select("id, gateway_id, store_uuid, room_uuid, beacon_minor, event_type, observed_at")
    .gte("observed_at", windowStartIso)
    .lte("observed_at", nowIso)
    .in("event_type", ["enter", "exit"])
    .order("observed_at", { ascending: true })
    .limit(5000)

  if (evErr) {
    return NextResponse.json(
      { ok: false, error: "EVENT_SCAN_FAILED", message: evErr.message },
      { status: 500 },
    )
  }
  const events = (eventsRaw ?? []) as BleEvent[]
  scanned = events.length

  // early exit if no work
  if (events.length === 0) {
    // still run reaper
    const reaperResult = await runReaper(supabase, dryRun, now)
    reaped = reaperResult.reaped
    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      lookback_min: lookbackMin,
      window: { from: windowStartIso, to: nowIso },
      scanned, created, closed, reaped,
      skipped,
    })
  }

  // ── 4. Resolve gateway + tag maps (batched) ───────────────
  const gatewayIds = Array.from(new Set(events.map(e => e.gateway_id)))
  const gwMap = new Map<string, GatewayRow>()
  if (gatewayIds.length > 0) {
    const { data: gws } = await supabase
      .from("ble_gateways")
      .select("gateway_id, store_uuid, room_uuid")
      .in("gateway_id", gatewayIds)
      .eq("is_active", true)
    for (const g of (gws ?? []) as GatewayRow[]) gwMap.set(g.gateway_id, g)
  }

  // tags: resolve per (store_uuid, minor). Need store_uuid from gateway.
  const tagKeyset = new Set<string>()
  const tagNeedByStore = new Map<string, Set<number>>()
  for (const ev of events) {
    const gw = gwMap.get(ev.gateway_id)
    if (!gw) continue
    const key = `${gw.store_uuid}__${ev.beacon_minor}`
    tagKeyset.add(key)
    const s = tagNeedByStore.get(gw.store_uuid) ?? new Set<number>()
    s.add(ev.beacon_minor)
    tagNeedByStore.set(gw.store_uuid, s)
  }
  const tagMap = new Map<string, TagRow>() // key = `${store_uuid}__${minor}`
  for (const [storeUuid, minors] of tagNeedByStore.entries()) {
    const { data: tags } = await supabase
      .from("ble_tags")
      .select("store_uuid, minor, membership_id")
      .eq("store_uuid", storeUuid)
      .in("minor", Array.from(minors))
      .eq("is_active", true)
    for (const t of (tags ?? []) as TagRow[]) {
      tagMap.set(`${t.store_uuid}__${t.minor}`, t)
    }
  }

  // hostesses.manager_membership_id snapshot (batched)
  const hostessIds = Array.from(
    new Set(
      Array.from(tagMap.values())
        .map(t => t.membership_id)
        .filter((v): v is string => !!v),
    ),
  )
  const managerByHostess = new Map<string, string | null>()
  if (hostessIds.length > 0) {
    const { data: hs } = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id")
      .in("membership_id", hostessIds)
      .is("deleted_at", null)
    for (const h of (hs ?? []) as { membership_id: string; manager_membership_id: string | null }[]) {
      managerByHostess.set(h.membership_id, h.manager_membership_id)
    }
  }

  // ── 5. Process events in observed_at order ────────────────
  // For each ENTER we'll consult "open draft" state. To avoid a query per
  // event, we pre-load open BLE drafts for the hostesses we'll touch.
  const { data: openDraftsRaw } = await supabase
    .from("staff_work_logs")
    .select("id, hostess_membership_id, working_store_uuid, working_store_room_uuid, started_at, source_ref")
    .eq("source", "ble")
    .eq("status", "draft")
    .is("ended_at", null)
    .is("deleted_at", null)
    .in("hostess_membership_id", hostessIds.length > 0 ? hostessIds : ["00000000-0000-0000-0000-000000000000"])

  // Keyed by `${hostess}__${working_store}__${room ?? ""}` → newest first
  const openByKey = new Map<string, OpenDraft[]>()
  for (const d of (openDraftsRaw ?? []) as OpenDraft[]) {
    const key = `${d.hostess_membership_id}__${d.working_store_uuid}__${d.working_store_room_uuid ?? ""}`
    const arr = openByKey.get(key) ?? []
    arr.push(d)
    openByKey.set(key, arr)
  }
  for (const arr of openByKey.values()) {
    arr.sort((a, b) => (a.started_at > b.started_at ? -1 : 1))
  }

  // Deterministic EXIT lookup across observed_at ties: sort by received ordering.
  // (already ordered by observed_at ASC from the query)

  for (const ev of events) {
    const gw = gwMap.get(ev.gateway_id)
    if (!gw) {
      skipped.gateway_unknown += 1
      if (!dryRun) await writeAudit(supabase, ev.gateway_id, null, "GATEWAY_UNKNOWN")
      continue
    }
    const workingStore = gw.store_uuid
    const roomUuid = ev.room_uuid ?? gw.room_uuid ?? null

    const tag = tagMap.get(`${workingStore}__${ev.beacon_minor}`)
    if (!tag) {
      skipped.tag_unknown += 1
      if (!dryRun) await writeAudit(supabase, ev.gateway_id, workingStore, "TAG_UNKNOWN")
      continue
    }
    if (!tag.membership_id) {
      skipped.tag_unassigned += 1
      if (!dryRun) await writeAudit(supabase, ev.gateway_id, workingStore, "TAG_UNASSIGNED")
      continue
    }
    const hostessId = tag.membership_id
    const originStore = tag.store_uuid
    const key = `${hostessId}__${workingStore}__${roomUuid ?? ""}`

    if (ev.event_type === "enter") {
      // Check existing open draft for same key
      const existing = openByKey.get(key) ?? []
      if (existing.length > 0) {
        skipped.already_open += 1
        continue
      }
      const ref = sourceRef(gw.gateway_id, ev.beacon_minor, ev.observed_at)
      const managerId = managerByHostess.get(hostessId) ?? null

      if (dryRun) {
        created += 1
        // Simulate adding to open map so subsequent EXIT in same run matches
        openByKey.set(key, [{
          id: "__dry__",
          hostess_membership_id: hostessId,
          working_store_uuid: workingStore,
          working_store_room_uuid: roomUuid,
          started_at: ev.observed_at,
          source_ref: ref,
        }])
        continue
      }

      const { data: inserted, error: insErr } = await supabase
        .from("staff_work_logs")
        .insert({
          origin_store_uuid: originStore,
          working_store_uuid: workingStore,
          hostess_membership_id: hostessId,
          manager_membership_id: managerId,
          started_at: ev.observed_at,
          ended_at: null,
          working_store_room_label: null,
          working_store_room_uuid: roomUuid,
          category: "etc",
          work_type: "cha3", // 임시 추론값 — EXIT 또는 reaper 가 재계산
          source: "ble",
          source_ref: ref,
          ble_event_id: ev.id,
          external_amount_hint: null,
          status: "draft",
          session_id: null,
          session_participant_id: null,
          cross_store_settlement_id: null,
          memo: "inferred from ble (pending exit)",
          created_by: null,
          created_by_role: "system",
        })
        .select("id, hostess_membership_id, working_store_uuid, working_store_room_uuid, started_at, source_ref")
        .single()

      if (insErr) {
        // 23505 = unique_violation → 다른 run 이 이미 만들었다. 정상 skip.
        const code = (insErr as { code?: string }).code
        if (code === "23505") {
          skipped.unique_conflict += 1
          continue
        }
        await writeAudit(supabase, ev.gateway_id, workingStore, `INSERT_FAILED:${insErr.message}`)
        continue
      }
      if (inserted) {
        created += 1
        const d: OpenDraft = {
          id: inserted.id as string,
          hostess_membership_id: hostessId,
          working_store_uuid: workingStore,
          working_store_room_uuid: roomUuid,
          started_at: inserted.started_at as string,
          source_ref: ref,
        }
        openByKey.set(key, [d])
      }
    } else if (ev.event_type === "exit") {
      const openArr = openByKey.get(key) ?? []
      const match = openArr[0] // newest first
      if (!match) {
        skipped.exit_orphan += 1
        if (!dryRun) await writeAudit(supabase, ev.gateway_id, workingStore, "EXIT_ORPHAN")
        continue
      }
      const startedMs = new Date(match.started_at).getTime()
      const endedMs = new Date(ev.observed_at).getTime()
      if (!Number.isFinite(endedMs) || endedMs < startedMs) {
        skipped.time_order_invalid += 1
        if (!dryRun) await writeAudit(supabase, ev.gateway_id, workingStore, "TIME_ORDER_INVALID")
        continue
      }
      const duration = endedMs - startedMs
      if (duration / 1000 < EXIT_TOLERANCE_SEC) {
        // debounce — EXIT 바로 뒤 ENTER 잡음
        skipped.exit_debounced += 1
        continue
      }
      const wt = inferWorkType(duration)
      if (!wt) {
        skipped.duration_too_short += 1
        if (!dryRun) await writeAudit(supabase, ev.gateway_id, workingStore, "DURATION_TOO_SHORT")
        // open draft 는 그대로 두어 후속 처리 (EXIT 이 또 오거나 reaper 처리)
        continue
      }

      if (dryRun) {
        closed += 1
        // 가상 close: 로컬 맵에서 제거
        openByKey.set(key, openArr.slice(1))
        continue
      }

      if (match.id === "__dry__") continue // 방어 (실행 모드 혼재 방지)

      const { error: updErr } = await supabase
        .from("staff_work_logs")
        .update({
          ended_at: ev.observed_at,
          work_type: wt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", match.id)
        .eq("status", "draft")
        .is("ended_at", null)
      if (updErr) {
        await writeAudit(supabase, ev.gateway_id, workingStore, `EXIT_UPDATE_FAILED:${updErr.message}`)
        continue
      }
      closed += 1
      openByKey.set(key, openArr.slice(1))
    } else {
      skipped.heartbeat_ignored += 1
    }
  }

  // ── 6. Reaper — MAX_OPEN_DURATION 초과 draft 자동 종료 ─────
  const reaperResult = await runReaper(supabase, dryRun, now)
  reaped = reaperResult.reaped

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    lookback_min: lookbackMin,
    window: { from: windowStartIso, to: nowIso },
    scanned,
    created,
    closed,
    reaped,
    skipped,
  })
}

// ── Reaper ──────────────────────────────────────────────────
// 4h 초과된 BLE draft 중 ended_at IS NULL 인 row 를 닫는다.
// 종료 시각: ble_presence_history 의 started_at 이후 last seen_at
//            → 있으면 그것으로, 없으면 started_at + DEFAULT_MIN.
async function runReaper(
  supabase: SupabaseClient,
  dryRun: boolean,
  nowMs: number,
): Promise<{ reaped: number }> {
  const cutoffIso = new Date(nowMs - MAX_OPEN_DURATION_MS).toISOString()
  const { data: stale } = await supabase
    .from("staff_work_logs")
    .select("id, hostess_membership_id, working_store_uuid, working_store_room_uuid, started_at")
    .eq("source", "ble")
    .eq("status", "draft")
    .is("ended_at", null)
    .is("deleted_at", null)
    .lt("started_at", cutoffIso)
    .limit(500)

  const staleRows = (stale ?? []) as Array<{
    id: string
    hostess_membership_id: string
    working_store_uuid: string
    working_store_room_uuid: string | null
    started_at: string
  }>

  if (staleRows.length === 0) return { reaped: 0 }
  if (dryRun) return { reaped: staleRows.length }

  let reaped = 0
  for (const row of staleRows) {
    // Try to use last presence_history.seen_at after started_at
    let endedIso: string
    const { data: lastSeen } = await supabase
      .from("ble_presence_history")
      .select("seen_at")
      .eq("membership_id", row.hostess_membership_id)
      .eq("store_uuid", row.working_store_uuid)
      .gt("seen_at", row.started_at)
      .order("seen_at", { ascending: false })
      .limit(1)
    const last = (lastSeen ?? [])[0] as { seen_at: string } | undefined
    if (last?.seen_at) {
      endedIso = last.seen_at
    } else {
      endedIso = new Date(new Date(row.started_at).getTime() + DEFAULT_MIN * 60 * 1000).toISOString()
    }
    const dur = new Date(endedIso).getTime() - new Date(row.started_at).getTime()
    const wt = inferWorkType(dur) ?? "cha3" // reaper 최소치: DEFAULT_MIN=15 → cha3

    const { error: updErr } = await supabase
      .from("staff_work_logs")
      .update({
        ended_at: endedIso,
        work_type: wt,
        memo: "reaper closed (no exit received)",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "draft")
      .is("ended_at", null)
    if (!updErr) reaped += 1
  }
  return { reaped }
}
