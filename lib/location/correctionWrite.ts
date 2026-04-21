/**
 * correctionWrite — server-side location correction write helper.
 *
 * SSOT rules (enforced by this module):
 *   - This module is the ONLY write path used by /api/location/correct.
 *   - It never performs `INSERT INTO location_correction_logs` directly.
 *   - It never performs `INSERT INTO ble_presence_corrections` directly.
 *   - It never performs `INSERT INTO ble_presence_history` directly.
 *   - All three inserts happen atomically inside the DB RPC
 *     `public.write_location_correction(payload jsonb)` defined in
 *     database/056_ble_presence_history.sql.
 *
 * Responsibilities:
 *   1. Resolve denormalised snapshot fields the RPC needs
 *      (target_name, store_name, room_no, floor, reviewer
 *      email/nickname/role/store_name).
 *   2. Call the RPC exactly once.
 *   3. Return the RPC's jsonb verbatim to the route layer.
 *
 * Failure modes:
 *   - Missing target membership or self-store lookup → returns {ok:false,error}.
 *   - RPC returning {deduplicated:true} is a success outcome — the caller
 *     propagates as 200 with the dedup flag.
 *   - RPC raising other errors surfaces as {ok:false, error}.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import type { ErrorType } from "@/lib/location/errorTypes"

export type CorrectionRequest = {
  target_membership_id: string
  detected: {
    floor: number | null
    store_uuid: string | null
    room_uuid: string | null
    zone: string | null
    at: string | null
  }
  corrected: {
    store_uuid: string
    room_uuid: string | null
    zone: string
    floor?: number | null
  }
  error_type: ErrorType
  correction_note?: string | null
  // optional — passed through to the RPC for overlay link
  session_id?: string | null
  participant_id?: string | null
  // optional — used only by RPC's history row (source='corrected')
  beacon_minor?: number | null
  // optional — overlay.reason
  reason?: string | null
}

export type CorrectionResult =
  | {
      ok: true
      deduplicated: false
      log_id: string
      overlay_correction_id: string
      applied: {
        corrected_zone: string
        corrected_room_uuid: string | null
        corrected_store_uuid: string
      }
    }
  | { ok: true; deduplicated: true; existing_log_id: string | null }
  | { ok: false; error: string; message?: string }

/**
 * Resolve the snapshot fields (target_name, store/room denorm, reviewer
 * email/nickname/role/store_name) in parallel and call the RPC.
 */
export async function writeCorrection(
  supabase: SupabaseClient,
  auth: AuthContext,
  req: CorrectionRequest,
): Promise<CorrectionResult> {
  // ── Snapshot lookups (Promise.all, 7 queries) ────────────────────

  // Target membership → profile
  const qTarget = supabase
    .from("store_memberships")
    .select("id, profile_id, store_uuid")
    .eq("id", req.target_membership_id)
    .is("deleted_at", null)
    .maybeSingle()

  const qDetectedStore = req.detected.store_uuid
    ? supabase.from("stores").select("id, store_name")
        .eq("id", req.detected.store_uuid).maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const qCorrectedStore = supabase
    .from("stores").select("id, store_name")
    .eq("id", req.corrected.store_uuid).maybeSingle()

  const qDetectedRoom = req.detected.room_uuid
    ? supabase.from("rooms").select("id, room_no, floor_no")
        .eq("id", req.detected.room_uuid).maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const qCorrectedRoom = req.corrected.room_uuid
    ? supabase.from("rooms").select("id, room_no, floor_no")
        .eq("id", req.corrected.room_uuid).maybeSingle()
    : Promise.resolve({ data: null, error: null })

  // Reviewer profile (for nickname)
  const qReviewer = supabase
    .from("profiles")
    .select("id, nickname, full_name")
    .eq("id", auth.user_id)
    .maybeSingle()

  // Reviewer's own store (for corrected_by_store_name)
  const qReviewerStore = supabase
    .from("stores").select("id, store_name")
    .eq("id", auth.store_uuid).maybeSingle()

  // Reviewer email via auth.users (no email column in public.profiles).
  // `supabase.auth.admin.getUserById` requires the service-role client —
  // the API route constructs one with SUPABASE_SERVICE_ROLE_KEY.
  const qReviewerEmail = supabase.auth.admin.getUserById(auth.user_id)

  const [
    target,
    detectedStore,
    correctedStore,
    detectedRoom,
    correctedRoom,
    reviewer,
    reviewerStore,
    reviewerAuth,
  ] = await Promise.all([
    qTarget,
    qDetectedStore,
    qCorrectedStore,
    qDetectedRoom,
    qCorrectedRoom,
    qReviewer,
    qReviewerStore,
    qReviewerEmail,
  ])

  if (!target.data) {
    return { ok: false, error: "TARGET_INVALID", message: "target_membership_id not found or deleted." }
  }
  if (!correctedStore.data) {
    return { ok: false, error: "CORRECTED_STORE_INVALID", message: "corrected_store_uuid does not resolve to a store." }
  }
  if (req.corrected.zone === "room" && !correctedRoom.data) {
    return { ok: false, error: "CORRECTED_ROOM_REQUIRED", message: "corrected_room_uuid must be a valid room when zone=room." }
  }

  // Target name: profiles.nickname || full_name — cheap single join result.
  let targetName = "알 수 없음"
  if (target.data.profile_id) {
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("nickname, full_name")
      .eq("id", target.data.profile_id)
      .maybeSingle()
    targetName =
      (targetProfile?.nickname as string | undefined) ||
      (targetProfile?.full_name as string | undefined) ||
      "알 수 없음"
  }

  const correctedFloor =
    req.corrected.floor ??
    (correctedRoom.data?.floor_no as number | null | undefined) ??
    null

  // ── Build RPC payload ─────────────────────────────────────────────
  // NOTE: empty strings for optional uuid/int fields → RPC uses NULLIF.
  const payload = {
    target_membership_id: req.target_membership_id,
    target_hostess_id: target.data.profile_id ?? "",
    target_name: targetName,

    detected_floor: req.detected.floor ?? (detectedRoom.data?.floor_no as number | null | undefined) ?? "",
    detected_store_uuid: req.detected.store_uuid ?? "",
    detected_store_name: (detectedStore.data?.store_name as string | undefined) ?? "",
    detected_room_uuid: req.detected.room_uuid ?? "",
    detected_room_no: (detectedRoom.data?.room_no as string | undefined) ?? "",
    detected_zone: req.detected.zone ?? "unknown",
    detected_at: req.detected.at ?? "",

    corrected_floor: correctedFloor ?? "",
    corrected_store_uuid: req.corrected.store_uuid,
    corrected_store_name: (correctedStore.data?.store_name as string | undefined) ?? "",
    corrected_room_uuid: req.corrected.room_uuid ?? "",
    corrected_room_no: (correctedRoom.data?.room_no as string | undefined) ?? "",
    corrected_zone: req.corrected.zone,

    corrected_by_user_id: auth.user_id,
    corrected_by_membership_id: auth.membership_id,
    corrected_by_email: reviewerAuth.data?.user?.email ?? "",
    corrected_by_nickname:
      (reviewer.data?.nickname as string | undefined) ||
      (reviewer.data?.full_name as string | undefined) ||
      "unknown",
    corrected_by_role: auth.is_super_admin ? "super_admin" : auth.role,
    corrected_by_store_uuid: auth.store_uuid,
    corrected_by_store_name: (reviewerStore.data?.store_name as string | undefined) ?? "",

    error_type: req.error_type,
    correction_note: req.correction_note ?? "",

    session_id: req.session_id ?? "",
    participant_id: req.participant_id ?? "",
    beacon_minor: req.beacon_minor != null ? String(req.beacon_minor) : "",
    reason: req.reason ?? "",
  }

  // ── Call the RPC — the ONLY write path. ───────────────────────────
  const { data, error } = await supabase.rpc("write_location_correction", {
    payload,
  })

  if (error) {
    return {
      ok: false,
      error: "RPC_FAILED",
      message: error.message,
    }
  }

  // RPC returns jsonb; supabase-js surfaces it as `data`.
  const result = (data ?? {}) as {
    ok?: boolean
    deduplicated?: boolean
    log_id?: string
    overlay_correction_id?: string
    existing_log_id?: string | null
    applied?: {
      corrected_zone: string
      corrected_room_uuid: string | null
      corrected_store_uuid: string
    }
  }

  if (result.deduplicated) {
    return {
      ok: true,
      deduplicated: true,
      existing_log_id: result.existing_log_id ?? null,
    }
  }

  if (result.ok && result.log_id && result.overlay_correction_id && result.applied) {
    return {
      ok: true,
      deduplicated: false,
      log_id: result.log_id,
      overlay_correction_id: result.overlay_correction_id,
      applied: result.applied,
    }
  }

  return {
    ok: false,
    error: "RPC_RESPONSE_INVALID",
    message: "write_location_correction returned an unexpected shape.",
  }
}
