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
 * POST /api/session-participant-actions/[action_id]/apply
 *
 * Execute the participant mutation associated with one operator
 * action. Idempotent — re-applying a row already at 'success' is a
 * no-op. Failures are recorded on the matching apply row.
 *
 * Auth: owner/manager only (same gate as the record / apply-actions
 * routes). Store scope enforced via the shared helper.
 */

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
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can apply participant actions." },
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

    // 1. Load action row (store-scoped).
    const { data: actionRow } = await supabase
      .from("session_participant_actions")
      .select("id, action_type, participant_id, session_id, store_uuid, effective_at, extension_count")
      .eq("id", action_id)
      .maybeSingle()
    if (!actionRow) {
      return NextResponse.json(
        { error: "ACTION_NOT_FOUND", message: "Action not found." },
        { status: 404 },
      )
    }
    if (actionRow.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Action belongs to another store." },
        { status: 403 },
      )
    }

    // 2. Load existing apply row (if any). Upsert a pending row when
    //    missing so the tracking invariant (one apply row per action)
    //    holds even for actions created before this pipeline landed.
    const now = new Date().toISOString()
    let { data: applyRow } = await supabase
      .from("session_participant_action_applies")
      .select("id, apply_status, attempt_count")
      .eq("action_id", action_id)
      .maybeSingle()
    if (!applyRow) {
      const { data: created, error: insErr } = await supabase
        .from("session_participant_action_applies")
        .insert({
          action_id: actionRow.id,
          participant_id: actionRow.participant_id,
          apply_status: "pending",
          requested_by: auth.membership_id,
          attempt_count: 1,
          last_attempted_at: now,
        })
        .select("id, apply_status, attempt_count")
        .single()
      if (insErr || !created) {
        return NextResponse.json(
          { error: "APPLY_ROW_INIT_FAILED", message: insErr?.message ?? "failed to initialize apply row" },
          { status: 500 },
        )
      }
      applyRow = created
    } else {
      // Touch last_attempted_at so observability reflects this attempt
      // (attempt_count is NOT bumped here — retry is the explicit
      // increment path per product rule).
      await supabase
        .from("session_participant_action_applies")
        .update({ last_attempted_at: now, updated_at: now })
        .eq("id", applyRow.id)
    }

    // 3. Execute through the shared helper.
    const outcome = await applySessionParticipantAction({
      supabase,
      auth,
      action: actionRow as ApplyActionRow,
      existingApply: applyRow as ApplyRow,
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
