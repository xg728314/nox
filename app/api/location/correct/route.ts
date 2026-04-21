import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { writeCorrection, type CorrectionRequest } from "@/lib/location/correctionWrite"
import {
  isErrorType,
  classifyErrorType,
  type ErrorType,
} from "@/lib/location/errorTypes"

/**
 * POST /api/location/correct
 *
 * Writes a BLE location correction atomically (overlay + audit log +
 * history) via the `write_location_correction()` RPC defined in
 * database/056_ble_presence_history.sql.
 *
 * Role gate: owner | manager | super_admin.
 *
 * This route NEVER writes to `ble_presence_corrections`,
 * `location_correction_logs`, or `ble_presence_history` directly.
 * All three tables mutate inside a single DB transaction managed by
 * the RPC. dedup (15s window, same target + same corrected location)
 * is enforced by a trigger on `location_correction_logs`; the API
 * surfaces that path as a 200 response with `deduplicated:true`.
 *
 * Legacy `/api/ble/corrections` remains untouched — external
 * automation can continue to use it.
 */

const ZONES = ["room", "counter", "restroom", "elevator", "external_floor"] as const
type Zone = typeof ZONES[number]

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

type BodyShape = {
  target_membership_id?: unknown
  detected?: {
    floor?: unknown
    store_uuid?: unknown
    room_uuid?: unknown
    zone?: unknown
    at?: unknown
  }
  corrected?: {
    floor?: unknown
    store_uuid?: unknown
    room_uuid?: unknown
    zone?: unknown
  }
  error_type?: unknown
  correction_note?: unknown
  session_id?: unknown
  participant_id?: unknown
  beacon_minor?: unknown
  reason?: unknown
}

export async function POST(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: e.type, message: e.message },
        { status: e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403 },
      )
    }
    return bad("INTERNAL_ERROR", "auth resolution failed", 500)
  }

  // Role gate — owner/manager/super_admin only
  const allowed = auth.role === "owner" || auth.role === "manager" || auth.is_super_admin
  if (!allowed) {
    return bad("ROLE_FORBIDDEN", "Only owner/manager/super_admin may record corrections.", 403)
  }

  // ── 2. Body parse + validation ───────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as BodyShape

  const target_membership_id =
    typeof body.target_membership_id === "string" ? body.target_membership_id.trim() : ""
  if (!isValidUUID(target_membership_id)) {
    return bad("BAD_REQUEST", "target_membership_id must be a valid UUID.")
  }

  const detRaw = body.detected ?? {}
  const corRaw = body.corrected ?? {}

  // corrected.zone required + enum check
  const corrected_zone_raw =
    typeof corRaw.zone === "string" ? corRaw.zone.trim() : ""
  if (!(ZONES as ReadonlyArray<string>).includes(corrected_zone_raw)) {
    return bad("BAD_REQUEST", `corrected.zone must be one of ${ZONES.join("|")}.`)
  }
  const corrected_zone = corrected_zone_raw as Zone

  // corrected.store_uuid — optional. 결정 규칙:
  //   1. caller 가 명시적으로 보낸 경우 (super_admin cross-store) — 검증 후 사용
  //   2. zone='room' + room_uuid 지정 → 서버가 rooms 테이블에서 파생
  //   3. fallback → auth.store_uuid (caller 자기 매장)
  // 최종 확정은 room 조회 후 아래에서.
  const corrected_store_uuid_raw =
    typeof corRaw.store_uuid === "string" && corRaw.store_uuid.trim().length > 0
      ? corRaw.store_uuid.trim() : null
  if (corrected_store_uuid_raw && !isValidUUID(corrected_store_uuid_raw)) {
    return bad("BAD_REQUEST", "corrected.store_uuid must be a valid UUID if provided.")
  }

  // corrected.room_uuid — required iff zone='room', else forbidden non-null
  const corrected_room_uuid_raw =
    typeof corRaw.room_uuid === "string" && corRaw.room_uuid.trim().length > 0
      ? corRaw.room_uuid.trim()
      : null
  if (corrected_zone === "room") {
    if (!corrected_room_uuid_raw || !isValidUUID(corrected_room_uuid_raw)) {
      return bad("BAD_REQUEST", "corrected.room_uuid is required and must be a UUID when zone=room.")
    }
  } else if (corrected_room_uuid_raw && !isValidUUID(corrected_room_uuid_raw)) {
    return bad("BAD_REQUEST", "corrected.room_uuid must be a UUID if provided.")
  }

  // detected fields — all optional, but if present must validate
  const detected_floor =
    typeof detRaw.floor === "number" && Number.isInteger(detRaw.floor) ? detRaw.floor : null
  const detected_store_uuid =
    typeof detRaw.store_uuid === "string" && detRaw.store_uuid.trim().length > 0
      ? (isValidUUID(detRaw.store_uuid.trim()) ? detRaw.store_uuid.trim() : null)
      : null
  const detected_room_uuid =
    typeof detRaw.room_uuid === "string" && detRaw.room_uuid.trim().length > 0
      ? (isValidUUID(detRaw.room_uuid.trim()) ? detRaw.room_uuid.trim() : null)
      : null
  const detected_zone =
    typeof detRaw.zone === "string" && detRaw.zone.trim().length > 0
      ? detRaw.zone.trim()
      : null
  const detected_at =
    typeof detRaw.at === "string" && detRaw.at.trim().length > 0 ? detRaw.at.trim() : null

  // error_type — explicit value must be valid now; auto-classify is
  // deferred until after corrected_store_uuid is derived (needs store
  // comparison for STORE_MISMATCH case).
  let error_type_explicit: ErrorType | null = null
  if (body.error_type !== undefined && body.error_type !== null && body.error_type !== "") {
    if (!isErrorType(body.error_type)) {
      return bad("BAD_REQUEST", "error_type has an invalid value.")
    }
    error_type_explicit = body.error_type
  }

  // correction_note ≤ 500
  const correction_note =
    typeof body.correction_note === "string" ? body.correction_note.trim().slice(0, 500) : null

  // optional pass-throughs
  const session_id =
    typeof body.session_id === "string" && isValidUUID(body.session_id.trim())
      ? body.session_id.trim() : null
  const participant_id =
    typeof body.participant_id === "string" && isValidUUID(body.participant_id.trim())
      ? body.participant_id.trim() : null
  const beacon_minor =
    typeof body.beacon_minor === "number" && Number.isInteger(body.beacon_minor)
      ? body.beacon_minor : null
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : null

  // corrected.floor explicit override (optional)
  const corrected_floor =
    typeof corRaw.floor === "number" && Number.isInteger(corRaw.floor) ? corRaw.floor : null

  // ── 3. Supabase client (store_uuid 파생에도 필요) ─────────────────
  let supabase
  try {
    supabase = supa()
  } catch {
    return bad("SERVER_CONFIG_ERROR", "Supabase not configured.", 500)
  }

  // ── 4. corrected_store_uuid 최종 결정 ───────────────────────────
  //   우선순위: 본문 명시 → room 에서 파생 → auth.store_uuid
  let corrected_store_uuid: string
  if (corrected_store_uuid_raw) {
    corrected_store_uuid = corrected_store_uuid_raw
  } else if (corrected_zone === "room" && corrected_room_uuid_raw) {
    const { data: roomRow } = await supabase
      .from("rooms")
      .select("store_uuid")
      .eq("id", corrected_room_uuid_raw)
      .is("deleted_at", null)
      .maybeSingle()
    if (!roomRow) {
      return bad("BAD_REQUEST", "corrected.room_uuid does not resolve to a room.")
    }
    corrected_store_uuid = (roomRow as { store_uuid: string }).store_uuid
  } else {
    corrected_store_uuid = auth.store_uuid
  }

  // ── 5. Cross-store guard for non-super_admin ────────────────────
  //   manager/owner 는 자기 매장 안에서만 correction 가능.
  //   super_admin 은 임의 매장 대상 가능.
  if (!auth.is_super_admin && corrected_store_uuid !== auth.store_uuid) {
    return bad("CROSS_STORE_FORBIDDEN",
      "Only super_admin can record corrections outside their own store.", 403)
  }

  // ── 5b. error_type 최종 결정 (auto-classify 는 store 비교 필요) ──
  const error_type: ErrorType = error_type_explicit ?? classifyErrorType({
    detected_store_uuid,
    detected_room_uuid,
    detected_zone,
    corrected_store_uuid,
    corrected_room_uuid: corrected_room_uuid_raw,
    corrected_zone,
  })

  const req: CorrectionRequest = {
    target_membership_id,
    detected: {
      floor: detected_floor,
      store_uuid: detected_store_uuid,
      room_uuid: detected_room_uuid,
      zone: detected_zone,
      at: detected_at,
    },
    corrected: {
      floor: corrected_floor,
      store_uuid: corrected_store_uuid,
      room_uuid: corrected_room_uuid_raw,
      zone: corrected_zone,
    },
    error_type,
    correction_note,
    session_id,
    participant_id,
    beacon_minor,
    reason,
  }

  // ── 6. RPC write (single TX in DB) ──────────────────────────────
  const result = await writeCorrection(supabase, auth, req)

  if (!result.ok) {
    const status =
      result.error === "TARGET_INVALID" ? 404 :
      result.error === "CORRECTED_STORE_INVALID" ? 400 :
      result.error === "CORRECTED_ROOM_REQUIRED" ? 400 :
      result.error === "RPC_FAILED" ? 500 :
      result.error === "RPC_RESPONSE_INVALID" ? 500 :
      500
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message ?? "" },
      { status },
    )
  }

  // ── 7. Response ──────────────────────────────────────────────────
  if (result.deduplicated) {
    return NextResponse.json({
      ok: true,
      deduplicated: true,
      existing_log_id: result.existing_log_id,
      error_type,
    }, { status: 200 })
  }

  return NextResponse.json({
    ok: true,
    deduplicated: false,
    log_id: result.log_id,
    overlay_correction_id: result.overlay_correction_id,
    applied: result.applied,
    error_type,
  }, { status: 200 })
}
