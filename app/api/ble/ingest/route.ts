import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { verifyBleSignature, hashRawBody } from "@/lib/ble/hmac"
import { allowBleRequest } from "@/lib/ble/rateLimit"

/**
 * POST /api/ble/ingest — hardened P0 implementation.
 *
 * Pipeline (in order, fail-closed at every step):
 *   1. Read required headers: x-gateway-id, x-gateway-signature.
 *   2. Rate limit keyed by x-gateway-id (10 req / 1 sec / gateway).
 *   3. Read raw body (string); length-bounded parse.
 *   4. Resolve gateway row by gateway_id (must exist, is_active, not deleted).
 *   5. HMAC-SHA256 verify header signature against raw body using the
 *      stored `gateway_secret` (constant-time compare).
 *   6. Parse JSON. Require `gateway_id` in body matching the header.
 *      Require `events` array with length ∈ [1, 200]; >200 → 413.
 *   7. Validate each event:
 *        - beacon_minor : integer in [0, 65535]
 *        - event_type   : enum { "enter", "exit", "heartbeat" }
 *        - rssi         : null | number in [-120, 0]
 *        - observed_at  : ISO timestamp, within [now - 5m, now + 30s]
 *      Any failure rejects the entire batch.
 *   8. Deduplicate intra-batch by
 *        (gateway_id, beacon_minor, observed_at, event_type).
 *      Then query `ble_ingest_events` for any matching rows within the
 *      last 5 minutes and drop those too (replay protection).
 *   9. Insert the surviving events into `ble_ingest_events`.
 *      Upsert `ble_tag_presence` for events whose beacon is a registered
 *      active tag in this store.
 *  10. Write ONE row to `ble_ingest_audit` (mandatory — audit failures
 *      surface as 500).
 *  11. Respond 200.
 *
 * This route NEVER creates participants, modifies sessions, mutates time
 * segments, or touches settlement. BLE remains an untrusted read-overlay
 * input until an explicit later round adds a separate, auditable
 * reconciliation path.
 */

const MAX_EVENTS_PER_REQUEST = 200
const MAX_BODY_BYTES = 256 * 1024 // 256 KB upper bound
const TS_FUTURE_SKEW_MS = 30 * 1000
const TS_PAST_WINDOW_MS = 5 * 60 * 1000
const EVENT_TYPES = new Set(["enter", "exit", "heartbeat"])

type BleEventInput = {
  beacon_minor: unknown
  event_type: unknown
  rssi?: unknown
  observed_at: unknown
}

type BleEventClean = {
  beacon_minor: number
  event_type: "enter" | "exit" | "heartbeat"
  rssi: number | null
  observed_at: string
}

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

async function writeAudit(
  supabase: SupabaseClient,
  row: {
    store_uuid: string | null
    gateway_id: string
    event_count: number
    success: boolean
    error_message: string | null
    raw_hash: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("ble_ingest_audit").insert(row)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function POST(request: Request) {
  // ── 1. Headers ───────────────────────────────────────────────────
  const headerGatewayId = request.headers.get("x-gateway-id")?.trim() ?? ""
  const headerSignature = request.headers.get("x-gateway-signature")?.trim() ?? ""
  if (!headerGatewayId || !headerSignature) {
    return NextResponse.json(
      { error: "AUTH_MISSING", message: "x-gateway-id and x-gateway-signature headers are required." },
      { status: 401 },
    )
  }

  // ── 2. Rate limit ────────────────────────────────────────────────
  const rl = allowBleRequest(headerGatewayId)
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMIT_EXCEEDED",
        message: `Too many requests for gateway ${headerGatewayId}.`,
        limit: rl.limit,
        window_ms: rl.windowMs,
      },
      { status: 429 },
    )
  }

  // ── 3. Raw body ──────────────────────────────────────────────────
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Unable to read request body." },
      { status: 400 },
    )
  }
  if (!rawBody) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Empty body." },
      { status: 400 },
    )
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", message: `Body exceeds ${MAX_BODY_BYTES} bytes.` },
      { status: 413 },
    )
  }

  const rawHash = hashRawBody(rawBody)

  // Supabase client — needed for gateway lookup + audit writes.
  let supabase: SupabaseClient
  try {
    supabase = supa()
  } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // ── 4. Resolve gateway by id ─────────────────────────────────────
  const { data: gateway, error: gwErr } = await supabase
    .from("ble_gateways")
    .select("id, store_uuid, room_uuid, gateway_secret, is_active")
    .eq("gateway_id", headerGatewayId)
    .maybeSingle()

  if (gwErr || !gateway) {
    // Best-effort audit of the attempt — store_uuid unknown.
    const au = await writeAudit(supabase, {
      store_uuid: null,
      gateway_id: headerGatewayId,
      event_count: 0,
      success: false,
      error_message: "GATEWAY_NOT_FOUND",
      raw_hash: rawHash,
    })
    if (!au.ok) {
      return NextResponse.json(
        { error: "AUDIT_WRITE_FAILED", message: au.error ?? "Audit insert failed." },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { error: "AUTH_INVALID", message: "Invalid gateway." },
      { status: 403 },
    )
  }

  if (!gateway.is_active) {
    const au = await writeAudit(supabase, {
      store_uuid: gateway.store_uuid,
      gateway_id: headerGatewayId,
      event_count: 0,
      success: false,
      error_message: "GATEWAY_INACTIVE",
      raw_hash: rawHash,
    })
    if (!au.ok) {
      return NextResponse.json(
        { error: "AUDIT_WRITE_FAILED", message: au.error ?? "Audit insert failed." },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { error: "GATEWAY_INACTIVE", message: "Gateway is inactive." },
      { status: 403 },
    )
  }

  // From here on we know the store — all failures are audited under it.
  const storeUuid: string = gateway.store_uuid
  const roomUuid: string | null = gateway.room_uuid ?? null

  const failAndAudit = async (
    status: number,
    code: string,
    message: string,
    event_count = 0,
  ) => {
    const au = await writeAudit(supabase, {
      store_uuid: storeUuid,
      gateway_id: headerGatewayId,
      event_count,
      success: false,
      error_message: `${code}: ${message}`,
      raw_hash: rawHash,
    })
    if (!au.ok) {
      return NextResponse.json(
        { error: "AUDIT_WRITE_FAILED", message: au.error ?? "Audit insert failed." },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: code, message }, { status })
  }

  // ── 5. HMAC verification ─────────────────────────────────────────
  if (!gateway.gateway_secret) {
    return failAndAudit(500, "SERVER_CONFIG_ERROR", "Gateway secret not configured.")
  }
  if (!verifyBleSignature(rawBody, gateway.gateway_secret, headerSignature)) {
    return failAndAudit(403, "SIGNATURE_INVALID", "HMAC signature mismatch.")
  }

  // ── 6. Parse body + batch envelope ───────────────────────────────
  let parsed: { gateway_id?: unknown; events?: unknown } = {}
  try {
    parsed = JSON.parse(rawBody) as typeof parsed
  } catch {
    return failAndAudit(400, "BAD_REQUEST", "Body is not valid JSON.")
  }
  const bodyGatewayId = typeof parsed.gateway_id === "string" ? parsed.gateway_id.trim() : ""
  if (!bodyGatewayId || bodyGatewayId !== headerGatewayId) {
    return failAndAudit(400, "BAD_REQUEST", "body.gateway_id must match header x-gateway-id.")
  }
  if (!Array.isArray(parsed.events)) {
    return failAndAudit(400, "BAD_REQUEST", "events must be an array.")
  }
  const rawEvents = parsed.events as unknown[]
  if (rawEvents.length === 0) {
    return failAndAudit(400, "BAD_REQUEST", "events must contain at least one event.")
  }
  if (rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    return failAndAudit(413, "PAYLOAD_TOO_LARGE",
      `events.length=${rawEvents.length} exceeds limit ${MAX_EVENTS_PER_REQUEST}.`)
  }

  // ── 7. Per-event schema + timestamp validation ───────────────────
  const nowMs = Date.now()
  const minPastMs = nowMs - TS_PAST_WINDOW_MS
  const maxFutureMs = nowMs + TS_FUTURE_SKEW_MS

  const clean: BleEventClean[] = []
  for (let i = 0; i < rawEvents.length; i++) {
    const e = rawEvents[i] as BleEventInput
    if (!e || typeof e !== "object") {
      return failAndAudit(400, "EVENT_SCHEMA_INVALID", `events[${i}] is not an object.`)
    }
    const bm = e.beacon_minor
    if (typeof bm !== "number" || !Number.isInteger(bm) || bm < 0 || bm > 65535) {
      return failAndAudit(400, "EVENT_SCHEMA_INVALID",
        `events[${i}].beacon_minor must be an integer in [0, 65535].`)
    }
    const et = e.event_type
    if (typeof et !== "string" || !EVENT_TYPES.has(et)) {
      return failAndAudit(400, "EVENT_SCHEMA_INVALID",
        `events[${i}].event_type must be one of enter|exit|heartbeat.`)
    }
    let rssi: number | null = null
    if (e.rssi !== undefined && e.rssi !== null) {
      if (typeof e.rssi !== "number" || !Number.isFinite(e.rssi) || e.rssi < -120 || e.rssi > 0) {
        return failAndAudit(400, "EVENT_SCHEMA_INVALID",
          `events[${i}].rssi must be a number in [-120, 0] or null.`)
      }
      rssi = e.rssi
    }
    const observed = e.observed_at
    if (typeof observed !== "string" || observed.length === 0) {
      return failAndAudit(400, "EVENT_SCHEMA_INVALID",
        `events[${i}].observed_at must be an ISO timestamp string.`)
    }
    const t = Date.parse(observed)
    if (!Number.isFinite(t)) {
      return failAndAudit(400, "EVENT_SCHEMA_INVALID",
        `events[${i}].observed_at is not a parseable timestamp.`)
    }
    if (t > maxFutureMs) {
      return failAndAudit(400, "TIMESTAMP_FUTURE",
        `events[${i}].observed_at is too far in the future.`)
    }
    if (t < minPastMs) {
      return failAndAudit(400, "TIMESTAMP_STALE",
        `events[${i}].observed_at is older than 5 minutes.`)
    }
    clean.push({
      beacon_minor: bm,
      event_type: et as BleEventClean["event_type"],
      rssi,
      // Normalize to ISO for consistent dedupe keys.
      observed_at: new Date(t).toISOString(),
    })
  }

  // ── 8. Dedupe intra-batch + against last 5m of stored events ─────
  const intraKeys = new Set<string>()
  const intraDeduped: BleEventClean[] = []
  for (const ev of clean) {
    const k = `${ev.beacon_minor}|${ev.observed_at}|${ev.event_type}`
    if (intraKeys.has(k)) continue
    intraKeys.add(k)
    intraDeduped.push(ev)
  }

  let newEvents: BleEventClean[] = intraDeduped
  try {
    const { data: existing, error: existErr } = await supabase
      .from("ble_ingest_events")
      .select("beacon_minor, observed_at, event_type")
      .eq("gateway_id", headerGatewayId)
      .gte("observed_at", new Date(minPastMs).toISOString())
      .in("beacon_minor", Array.from(new Set(intraDeduped.map(e => e.beacon_minor))))
    if (existErr) {
      return failAndAudit(500, "DEDUPE_QUERY_FAILED", existErr.message, clean.length)
    }
    const existingSet = new Set(
      (existing ?? []).map((r: { beacon_minor: number; observed_at: string; event_type: string }) =>
        `${r.beacon_minor}|${new Date(r.observed_at).toISOString()}|${r.event_type}`,
      ),
    )
    newEvents = intraDeduped.filter(
      ev => !existingSet.has(`${ev.beacon_minor}|${ev.observed_at}|${ev.event_type}`),
    )
  } catch (e) {
    return failAndAudit(500, "DEDUPE_QUERY_FAILED",
      e instanceof Error ? e.message : "Unexpected error.", clean.length)
  }

  // ── 9. Persist events + presence ─────────────────────────────────
  if (newEvents.length > 0) {
    const rows = newEvents.map(ev => ({
      gateway_id: headerGatewayId,
      store_uuid: storeUuid,
      room_uuid: roomUuid,
      beacon_minor: ev.beacon_minor,
      event_type: ev.event_type,
      rssi: ev.rssi,
      observed_at: ev.observed_at,
      meta: {},
    }))
    const { error: insertError } = await supabase.from("ble_ingest_events").insert(rows)
    if (insertError) {
      return failAndAudit(500, "INSERT_FAILED", insertError.message, newEvents.length)
    }

    // Tag presence upsert — resolve known active tags in THIS store only.
    const minors = Array.from(new Set(newEvents.map(ev => ev.beacon_minor)))
    const { data: tags, error: tagsErr } = await supabase
      .from("ble_tags")
      .select("minor, membership_id, is_active")
      .eq("store_uuid", storeUuid)
      .in("minor", minors)
    if (tagsErr) {
      return failAndAudit(500, "TAG_LOOKUP_FAILED", tagsErr.message, newEvents.length)
    }
    const tagMap = new Map(
      (tags ?? [])
        .filter((t: { is_active: boolean }) => t.is_active)
        .map((t: { minor: number; membership_id: string | null; is_active: boolean }) => [t.minor, t]),
    )

    // ── meaningful-change gate (Phase 1 추가): ─────────────────────
    //   heartbeat 마다 ble_presence_history 에 저장하는 것을 금지한다.
    //   저장 조건:
    //     - 해당 (store, minor) 의 last-known 이 없음
    //     - OR last.room_uuid 가 현재 roomUuid 와 다름
    //     - OR (event.observed_at - last.last_seen_at) >= 10s
    //   gate 통과한 이벤트만 배치 insert 한다. 기존 ble_tag_presence
    //   upsert 경로는 건드리지 않는다.
    //   참조: database/056_ble_presence_history.sql
    //         orchestration/tasks/ble-monitor-final-extension.md
    //         [BLE HISTORY SAFETY RULE]
    const HISTORY_GAP_MS = 10_000
    const lastKnownMap = new Map<number, {
      room_uuid: string | null
      last_seen_at: string | null
    }>()
    try {
      const { data: lastRows } = await supabase
        .from("ble_tag_presence")
        .select("minor, room_uuid, last_seen_at")
        .eq("store_uuid", storeUuid)
        .in("minor", minors)
      for (const r of (lastRows ?? [])) {
        const row = r as { minor: number; room_uuid: string | null; last_seen_at: string | null }
        lastKnownMap.set(row.minor, {
          room_uuid: row.room_uuid ?? null,
          last_seen_at: row.last_seen_at ?? null,
        })
      }
    } catch {
      // Non-critical. 읽기 실패 시 gate 가 모두 "no last-known" 으로 판정되어
      // 해당 배치는 전부 append 쪽으로 떨어진다 — 데이터 누락보다 중복 허용.
    }

    const historyRows: Array<{
      store_uuid: string
      membership_id: string | null
      minor: number
      room_uuid: string | null
      zone: string
      last_event_type: string
      seen_at: string
      gateway_id: string
      source: string
    }> = []

    for (const ev of newEvents) {
      const tag = tagMap.get(ev.beacon_minor)
      if (!tag) continue
      const { error: presErr } = await supabase
        .from("ble_tag_presence")
        .upsert(
          {
            store_uuid: storeUuid,
            minor: ev.beacon_minor,
            room_uuid: roomUuid,
            membership_id: tag.membership_id,
            last_event_type: ev.event_type,
            last_seen_at: ev.observed_at,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "store_uuid,minor" },
        )
      if (presErr) {
        return failAndAudit(500, "PRESENCE_UPSERT_FAILED", presErr.message, newEvents.length)
      }

      // ── gate 평가 ────────────────────────────────────────────────
      const last = lastKnownMap.get(ev.beacon_minor)
      const eventTimeMs = new Date(ev.observed_at).getTime()
      const lastTimeMs = last?.last_seen_at ? new Date(last.last_seen_at).getTime() : null
      const noLast = !last
      const roomChanged = !last || (last.room_uuid ?? null) !== roomUuid
      const gapExceeded =
        lastTimeMs === null || (eventTimeMs - lastTimeMs) >= HISTORY_GAP_MS
      const shouldAppendHistory = noLast || roomChanged || gapExceeded

      if (shouldAppendHistory) {
        historyRows.push({
          store_uuid: storeUuid,
          membership_id: tag.membership_id,
          minor: ev.beacon_minor,
          room_uuid: roomUuid,
          // Ingest 시점엔 zone 을 직접 derive 하지 않는다 — monitor read
          // 가 담당. room_uuid 유무로만 최소 힌트 남김.
          zone: roomUuid ? "room" : "unknown",
          last_event_type: ev.event_type,
          seen_at: ev.observed_at,
          gateway_id: headerGatewayId,
          source: "ble",
        })
        // intra-batch 같은 minor 의 후속 이벤트가 동일 gate 를 또 통과
        // 하지 않도록 로컬 lastKnownMap 갱신.
        lastKnownMap.set(ev.beacon_minor, {
          room_uuid: roomUuid,
          last_seen_at: ev.observed_at,
        })
      }
    }

    // ── 배치 history insert ──────────────────────────────────────
    if (historyRows.length > 0) {
      const { error: histErr } = await supabase
        .from("ble_presence_history")
        .insert(historyRows)
      if (histErr) {
        return failAndAudit(500, "HISTORY_INSERT_FAILED", histErr.message, newEvents.length)
      }
    }
  }

  // ── 10. Success audit (mandatory — failure surfaces as 500) ──────
  const au = await writeAudit(supabase, {
    store_uuid: storeUuid,
    gateway_id: headerGatewayId,
    event_count: newEvents.length,
    success: true,
    error_message: null,
    raw_hash: rawHash,
  })
  if (!au.ok) {
    return NextResponse.json(
      { error: "AUDIT_WRITE_FAILED", message: au.error ?? "Audit insert failed." },
      { status: 500 },
    )
  }

  // ── 11. Response ─────────────────────────────────────────────────
  return NextResponse.json({
    success: true,
    received: rawEvents.length,
    accepted: newEvents.length,
    duplicates_skipped: rawEvents.length - newEvents.length,
    store_uuid: storeUuid,
    room_uuid: roomUuid,
  })
}
