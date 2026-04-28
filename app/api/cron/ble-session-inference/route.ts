import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "node:crypto"
import { stampCronHeartbeat } from "@/lib/automation/cronHeartbeat"
import {
  inferWorkType as inferWorkTypePure,
  sourceRef as sourceRefPure,
  WINDOW_SEC as WINDOW_SEC_PURE,
  DURATION_MIN_SKIP as DURATION_MIN_SKIP_PURE,
} from "@/lib/server/queries/bleSessionInference"

/**
 * GET /api/cron/ble-session-inference
 *
 * ⚠️ 2026-04-24 재작성:
 *   라이브 DB 에 `staff_work_logs` 테이블이 없고 `cross_store_work_records`
 *   만 존재. 구 cron 은 BLE ENTER/EXIT 이벤트를 staff_work_logs 에
 *   materialize 했으며, 다음 전용 컬럼을 필수로 사용했다:
 *     - source, source_ref, ble_event_id
 *     - started_at, ended_at
 *     - work_type, category
 *     - manager_membership_id, created_by, created_by_role
 *     - working_store_room_uuid, working_store_room_label
 *     - external_amount_hint, memo
 *
 *   cross_store_work_records 에는 위 컬럼이 **하나도** 존재하지 않으며,
 *   `session_id` 는 NOT NULL 이다. BLE beacon 이벤트만으로는 session_id
 *   를 결정론적으로 특정할 수 없다 (beacon 은 gateway/minor 만 제공).
 *   task 정책:
 *     "requested_by 를 cron 에서 특정할 수 없으면 NOT NULL 여부를 실제
 *      schema 로 확인. NOT NULL 이면 cron 에서는 insert 하지 말고
 *      로그/skip 처리한다."
 *   → `session_id` (NOT NULL) 도 동일 원칙으로 skip.
 *
 *   따라서 본 cron 은 **관찰(스캔/집계)만** 수행하고 INSERT/UPDATE 를
 *   하지 않는다. ble_ingest_events 카운트 + skip 사유만 로그. 재개는
 *   별도 라운드에서 "ble 이벤트 → session_id 매핑" 설계 후.
 *
 * 보안:
 *   - Authorization: Bearer <CRON_SECRET>  (timingSafeEqual)
 *   - user-agent: vercel-cron/*
 *   둘 중 하나라도 통과해야 진입.
 *
 * Query:
 *   ?dry_run=1   → (동작 동일, 본 라운드는 write 자체가 없음)
 *   ?lookback=30 → 분 단위 스캔 폭. 기본 30, 최대 180.
 *
 * 응답:
 *   { ok, dry_run, lookback_min, scanned, created: 0, closed: 0, reaped: 0,
 *     skipped: {...}, note: "observation_only — staff_work_logs removed" }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Locked constants — pure helper 에서 재사용 (테스트 호환).
const WINDOW_SEC = WINDOW_SEC_PURE
const DURATION_MIN_SKIP = DURATION_MIN_SKIP_PURE
const DEFAULT_SCAN_LOOKBACK_MIN = 30
const MAX_SCAN_LOOKBACK_MIN = 180

// silence unused (pure helpers kept for future rewrite)
void inferWorkTypePure
void sourceRefPure
void WINDOW_SEC
void DURATION_MIN_SKIP

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

type BleEvent = {
  id: string
  gateway_id: string
  store_uuid: string | null
  room_uuid: string | null
  beacon_minor: number
  event_type: "enter" | "exit" | "heartbeat"
  observed_at: string
}

type SkipCounters = {
  /** staff_work_logs 테이블 부재로 materialize skip */
  materialize_disabled: number
  gateway_unknown: number
  tag_unknown: number
  tag_unassigned: number
  heartbeat_ignored: number
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
  const lookbackRaw = Number(url.searchParams.get("lookback") ?? DEFAULT_SCAN_LOOKBACK_MIN)
  const lookbackMin = Number.isFinite(lookbackRaw)
    ? Math.min(MAX_SCAN_LOOKBACK_MIN, Math.max(1, Math.floor(lookbackRaw)))
    : DEFAULT_SCAN_LOOKBACK_MIN

  let supabase: SupabaseClient
  try {
    supabase = supa()
  } catch {
    return NextResponse.json({ ok: false, error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // R24: heartbeat
  await stampCronHeartbeat(supabase, "ble-session-inference", "started")

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const windowStartIso = new Date(now - lookbackMin * 60 * 1000).toISOString()

  const skipped: SkipCounters = {
    materialize_disabled: 0,
    gateway_unknown: 0,
    tag_unknown: 0,
    tag_unassigned: 0,
    heartbeat_ignored: 0,
  }

  // 3. 이벤트 스캔 (관찰)
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
  const scanned = events.length

  // 4. materialize 는 하지 않는다. enter/exit 이벤트는 전량 skip 으로 집계.
  //    staff_work_logs 테이블이 없고, cross_store_work_records 는 session_id
  //    NOT NULL 이라 beacon 데이터만으로는 생성 불가. 운영에서 근무 기록은
  //    수동 (/api/staff-work-logs POST) 경로로 생성.
  for (const ev of events) {
    if (ev.event_type === "enter" || ev.event_type === "exit") {
      skipped.materialize_disabled += 1
    } else {
      skipped.heartbeat_ignored += 1
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    lookback_min: lookbackMin,
    window: { from: windowStartIso, to: nowIso },
    scanned,
    created: 0,
    closed: 0,
    reaped: 0,
    skipped,
    note:
      "observation_only — staff_work_logs 부재 및 cross_store_work_records.session_id NOT NULL 제약으로 beacon → work record 자동 materialize 비활성.",
  })
}
