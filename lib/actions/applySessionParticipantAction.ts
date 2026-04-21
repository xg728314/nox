import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { writeSessionAudit } from "@/lib/session/auditWriter"

/**
 * Shared per-action apply helper.
 *
 * Callers:
 *   - POST /api/session-participant-actions/[action_id]/apply
 *   - POST /api/session-participant-actions/[action_id]/retry
 *
 * Responsibilities:
 *   1. Idempotent short-circuit when the apply row is already 'success'.
 *   2. Validate participant / session / store scope / business day.
 *   3. Execute the per-action_type mutation on `session_participants`
 *      using the same semantics the batch route has relied on.
 *   4. Advance the participant's `last_applied_action_id` cursor.
 *   5. Write the audit event.
 *   6. Transition the apply row to 'success' (or 'failed' with a
 *      structured failure_code/message on any failure).
 *
 * The helper NEVER touches settlement / orders / receipts / BLE raw
 * tables. Transactional counter flow is untouched.
 */

export type ApplyActionType = "still_working" | "end_now" | "extend"

export type ApplyFailureCode =
  | "PARTICIPANT_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ACTIVE"
  | "STORE_MISMATCH"
  | "BUSINESS_DAY_CLOSED"
  | "INVALID_ACTION_TYPE"
  | "CONFLICT"
  | "INTERNAL_ERROR"

export type ApplyActionRow = {
  id: string
  action_type: ApplyActionType
  participant_id: string
  session_id: string
  store_uuid: string
  effective_at: string
  extension_count: number | null
}

export type ApplyRow = {
  id: string
  apply_status: "pending" | "success" | "failed"
  attempt_count: number
}

export type ApplyResultKind =
  | "already_applied"
  | "noop"               // still_working
  | "left"               // end_now → soft-close at effective_at
  | "kicked"             // end_now with elapsed < 12m → kick semantics
  | "marked_for_billing" // extend → audit-only marker

export type ApplyOutcome =
  | { ok: true; already_applied: true;  result: "already_applied"; apply_status: "success" }
  | { ok: true; already_applied: false; result: Exclude<ApplyResultKind, "already_applied">; apply_status: "success"; extension_count?: number | null }
  | { ok: false; code: ApplyFailureCode; message: string; apply_status: "failed" }

const KICK_THRESHOLD_MS = 12 * 60 * 1000

export async function applySessionParticipantAction(opts: {
  supabase: SupabaseClient
  auth: AuthContext
  action: ApplyActionRow
  existingApply: ApplyRow | null
}): Promise<ApplyOutcome> {
  const { supabase, auth, action, existingApply } = opts
  const applyRowId = existingApply?.id ?? null

  // 1. Idempotent short-circuit.
  if (existingApply?.apply_status === "success") {
    return { ok: true, already_applied: true, result: "already_applied", apply_status: "success" }
  }

  // 2. Validate participant + session + store scope + business day.
  const { data: part } = await supabase
    .from("session_participants")
    .select("id, session_id, store_uuid, status, entered_at, left_at, price_amount, time_minutes, last_applied_action_id")
    .eq("id", action.participant_id)
    .is("deleted_at", null)
    .maybeSingle()
  if (!part) {
    await writeFailure(supabase, applyRowId, "PARTICIPANT_NOT_FOUND", "Participant not found.")
    return { ok: false, code: "PARTICIPANT_NOT_FOUND", message: "Participant not found.", apply_status: "failed" }
  }
  if (part.store_uuid !== auth.store_uuid) {
    await writeFailure(supabase, applyRowId, "STORE_MISMATCH", "Participant belongs to another store.")
    return { ok: false, code: "STORE_MISMATCH", message: "Participant belongs to another store.", apply_status: "failed" }
  }

  const { data: sess } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, status, business_day_id")
    .eq("id", action.session_id)
    .maybeSingle()
  if (!sess) {
    await writeFailure(supabase, applyRowId, "SESSION_NOT_FOUND", "Session not found.")
    return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found.", apply_status: "failed" }
  }
  if (sess.store_uuid !== auth.store_uuid) {
    await writeFailure(supabase, applyRowId, "STORE_MISMATCH", "Session belongs to another store.")
    return { ok: false, code: "STORE_MISMATCH", message: "Session belongs to another store.", apply_status: "failed" }
  }
  if (sess.status !== "active") {
    await writeFailure(supabase, applyRowId, "SESSION_NOT_ACTIVE", "Session is not active.")
    return { ok: false, code: "SESSION_NOT_ACTIVE", message: "Session is not active.", apply_status: "failed" }
  }
  const dayGuard = await assertBusinessDayOpen(supabase, sess.business_day_id)
  if (dayGuard) {
    await writeFailure(supabase, applyRowId, "BUSINESS_DAY_CLOSED", "Business day is closed.")
    return { ok: false, code: "BUSINESS_DAY_CLOSED", message: "Business day is closed.", apply_status: "failed" }
  }

  // 3. Compute the participant update payload per action_type.
  let result: Exclude<ApplyResultKind, "already_applied"> = "noop"
  const updateFields: Record<string, unknown> = {}

  try {
    switch (action.action_type) {
      case "still_working":
        // No participant state change. Cursor advance below.
        result = "noop"
        break

      case "end_now": {
        if (part.status === "left") {
          // Participant already left — treat as already-applied and
          // avoid a second left_at overwrite.
          await markSuccess(supabase, applyRowId, action, auth)
          return { ok: true, already_applied: true, result: "already_applied", apply_status: "success" }
        }
        const enteredMs = part.entered_at ? new Date(part.entered_at).getTime() : 0
        const effectiveMs = new Date(action.effective_at).getTime()
        const elapsedMs = enteredMs > 0 ? Math.max(0, effectiveMs - enteredMs) : 0
        const exitType = elapsedMs < KICK_THRESHOLD_MS && enteredMs > 0 ? "kicked" : "left"
        updateFields.status = "left"
        updateFields.left_at = action.effective_at
        if (exitType === "kicked") {
          updateFields.price_amount = 0
          updateFields.manager_payout_amount = 0
          updateFields.hostess_payout_amount = 0
          updateFields.margin_amount = 0
        }
        result = exitType === "kicked" ? "kicked" : "left"
        break
      }

      case "extend":
        if (part.status === "left") {
          await markSuccess(supabase, applyRowId, action, auth)
          return { ok: true, already_applied: true, result: "already_applied", apply_status: "success" }
        }
        // Deliberately NO money/time mutation. Authoritative extend
        // path remains /api/sessions/extend. This helper only records
        // the operator-intent marker in the audit log.
        result = "marked_for_billing"
        break

      default:
        await writeFailure(supabase, applyRowId, "INVALID_ACTION_TYPE", `Unknown action: ${String(action.action_type)}`)
        return { ok: false, code: "INVALID_ACTION_TYPE", message: `Unknown action: ${String(action.action_type)}`, apply_status: "failed" }
    }

    // Advance cursor regardless of action_type.
    updateFields.last_applied_action_id = action.id

    // 4. Commit participant update (single UPDATE, store-scoped).
    const { error: upErr } = await supabase
      .from("session_participants")
      .update(updateFields)
      .eq("id", action.participant_id)
      .eq("store_uuid", auth.store_uuid)
    if (upErr) {
      await writeFailure(supabase, applyRowId, "CONFLICT", upErr.message)
      return { ok: false, code: "CONFLICT", message: upErr.message, apply_status: "failed" }
    }

    // 5. Audit event (best-effort, matches existing mid-out/extend pattern).
    await writeSessionAudit(supabase, {
      auth,
      session_id: action.session_id,
      entity_table: "session_participants",
      entity_id: action.participant_id,
      action:
        action.action_type === "still_working" ? "participant_still_working_applied" :
        action.action_type === "end_now" && result === "kicked" ? "participant_kicked" :
        action.action_type === "end_now" ? "participant_mid_out" :
        "participant_extension_marked",
      after: {
        action_id: action.id,
        result,
        extension_count: action.action_type === "extend" ? action.extension_count : undefined,
        source: "apply_session_participant_action",
      },
    })

    // 6. Mark apply row success.
    await markSuccess(supabase, applyRowId, action, auth)

    return {
      ok: true,
      already_applied: false,
      result,
      extension_count: action.action_type === "extend" ? action.extension_count : undefined,
      apply_status: "success",
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error"
    await writeFailure(supabase, applyRowId, "INTERNAL_ERROR", msg)
    return { ok: false, code: "INTERNAL_ERROR", message: msg, apply_status: "failed" }
  }
}

async function writeFailure(
  supabase: SupabaseClient,
  applyRowId: string | null,
  code: ApplyFailureCode,
  message: string,
): Promise<void> {
  if (!applyRowId) return
  const now = new Date().toISOString()
  await supabase
    .from("session_participant_action_applies")
    .update({
      apply_status: "failed",
      failed_at: now,
      failure_code: code,
      failure_message: message.slice(0, 500),
      last_attempted_at: now,
      updated_at: now,
    })
    .eq("id", applyRowId)
}

async function markSuccess(
  supabase: SupabaseClient,
  applyRowId: string | null,
  action: ApplyActionRow,
  auth: AuthContext,
): Promise<void> {
  const now = new Date().toISOString()
  if (applyRowId) {
    await supabase
      .from("session_participant_action_applies")
      .update({
        apply_status: "success",
        applied_at: now,
        failed_at: null,
        failure_code: null,
        failure_message: null,
        last_attempted_at: now,
        updated_at: now,
      })
      .eq("id", applyRowId)
  } else {
    // Upsert on-the-fly for actions whose auto-creation step didn't
    // land (e.g., actions created before the apply-tracking pipeline
    // existed). Attempt count is 1 because this is the first
    // successfully-recorded attempt.
    await supabase.from("session_participant_action_applies").insert({
      action_id: action.id,
      participant_id: action.participant_id,
      apply_status: "success",
      applied_at: now,
      last_attempted_at: now,
      attempt_count: 1,
      requested_by: auth.membership_id,
    })
  }
}
