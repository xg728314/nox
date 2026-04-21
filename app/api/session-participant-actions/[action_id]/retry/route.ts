import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  applySessionParticipantAction,
  type ApplyActionRow,
  type ApplyRow,
} from "@/lib/actions/applySessionParticipantAction"

/**
 * POST /api/session-participant-actions/[action_id]/retry
 *
 * Retry a previously-failed apply attempt, or a stuck-pending attempt
 * whose last_attempted_at is older than the stale threshold. Fails
 * fast when the row is already at 'success'.
 *
 * Unlike /apply this endpoint increments `attempt_count`.
 *
 * Auth: owner/manager only. Store scope enforced via the shared
 * helper (same path as /apply).
 */

const STALE_PENDING_MS = 5 * 60 * 1000

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can retry participant actions." },
        { status: 403 },
      )
    }

    const { action_id } = await params
    if (!isValidUUID(action_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "action_id must be a valid UUID." },
        { status: 400 },
      )
    }

    const supabase = supa()

    // 1. Load action row + store scope.
    const { data: actionRow } = await supabase
      .from("session_participant_actions")
      .select("id, action_type, participant_id, session_id, store_uuid, effective_at, extension_count")
      .eq("id", action_id)
      .maybeSingle()
    if (!actionRow) {
      return NextResponse.json({ error: "ACTION_NOT_FOUND", message: "Action not found." }, { status: 404 })
    }
    if (actionRow.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Action belongs to another store." },
        { status: 403 },
      )
    }

    // 2. Load apply row.
    const { data: applyRow } = await supabase
      .from("session_participant_action_applies")
      .select("id, apply_status, attempt_count, last_attempted_at")
      .eq("action_id", action_id)
      .maybeSingle()

    // 3. Retry eligibility:
    //    - apply_status='failed' → always eligible
    //    - apply_status='pending' AND last_attempted_at older than
    //      STALE_PENDING_MS (or null) → eligible (stuck)
    //    - apply_status='success' → 409, no re-apply
    //    - no apply row at all → also eligible (behaves like /apply
    //      with an implicit attempt_count=1; we upsert)
    const nowMs = Date.now()
    if (applyRow?.apply_status === "success") {
      return NextResponse.json(
        { error: "ALREADY_APPLIED", message: "Action already successfully applied." },
        { status: 409 },
      )
    }
    if (applyRow?.apply_status === "pending") {
      const lastMs = applyRow.last_attempted_at ? Date.parse(applyRow.last_attempted_at) : 0
      const stale = !Number.isFinite(lastMs) || (nowMs - lastMs) > STALE_PENDING_MS
      if (!stale) {
        return NextResponse.json(
          {
            error: "NOT_STALE_YET",
            message: `Pending attempt in flight. Retry allowed after ${Math.ceil(STALE_PENDING_MS / 60_000)}m.`,
            last_attempted_at: applyRow.last_attempted_at,
          },
          { status: 409 },
        )
      }
    }

    // 4. Increment attempt_count + touch last_attempted_at. On the
    //    missing-row path we upsert a new row at attempt_count=2 so
    //    the "retry" semantics are preserved (attempt 1 was the
    //    implicit creation, attempt 2 is this retry).
    const nowIso = new Date().toISOString()
    let workingApply: ApplyRow
    if (!applyRow) {
      const { data: created, error: insErr } = await supabase
        .from("session_participant_action_applies")
        .insert({
          action_id: actionRow.id,
          participant_id: actionRow.participant_id,
          apply_status: "pending",
          requested_by: auth.membership_id,
          attempt_count: 2,
          last_attempted_at: nowIso,
        })
        .select("id, apply_status, attempt_count")
        .single()
      if (insErr || !created) {
        return NextResponse.json(
          { error: "APPLY_ROW_INIT_FAILED", message: insErr?.message ?? "failed to initialize apply row" },
          { status: 500 },
        )
      }
      workingApply = created as ApplyRow
    } else {
      const { data: updated, error: upErr } = await supabase
        .from("session_participant_action_applies")
        .update({
          apply_status: "pending",
          attempt_count: applyRow.attempt_count + 1,
          last_attempted_at: nowIso,
          failure_code: null,
          failure_message: null,
          updated_at: nowIso,
        })
        .eq("id", applyRow.id)
        .select("id, apply_status, attempt_count")
        .single()
      if (upErr || !updated) {
        return NextResponse.json(
          { error: "APPLY_ROW_UPDATE_FAILED", message: upErr?.message ?? "failed to prepare retry" },
          { status: 500 },
        )
      }
      workingApply = updated as ApplyRow
    }

    // 5. Call the shared helper. Same mutation path as /apply.
    const outcome = await applySessionParticipantAction({
      supabase,
      auth,
      action: actionRow as ApplyActionRow,
      existingApply: workingApply,
    })

    if (outcome.ok) {
      return NextResponse.json(
        {
          ok: true,
          action_id,
          participant_id: actionRow.participant_id,
          already_applied: outcome.already_applied,
          result: outcome.result,
          extension_count: "extension_count" in outcome ? outcome.extension_count ?? null : null,
          apply_status: outcome.apply_status,
          attempt_count: workingApply.attempt_count,
        },
        { status: outcome.already_applied ? 200 : 201 },
      )
    }
    return NextResponse.json(
      {
        ok: false,
        action_id,
        participant_id: actionRow.participant_id,
        apply_status: outcome.apply_status,
        failure_code: outcome.code,
        failure_message: outcome.message,
        attempt_count: workingApply.attempt_count,
      },
      { status: outcome.code === "STORE_MISMATCH" ? 403 :
                outcome.code === "PARTICIPANT_NOT_FOUND" || outcome.code === "SESSION_NOT_FOUND" ? 404 :
                outcome.code === "SESSION_NOT_ACTIVE" || outcome.code === "BUSINESS_DAY_CLOSED" ? 409 :
                outcome.code === "INVALID_ACTION_TYPE" ? 400 :
                outcome.code === "CONFLICT" ? 409 :
                500 },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
