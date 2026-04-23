import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { isValidUUID } from "@/lib/validation"
import {
  applySessionParticipantAction,
  type ApplyActionRow,
  type ApplyRow,
} from "@/lib/actions/applySessionParticipantAction"

/**
 * POST /api/sessions/participants/apply-actions
 *
 * BATCH consolidation endpoint. Applies every un-applied operator action
 * in `session_participant_actions` for one participant by delegating,
 * one row at a time, to the shared helper `applySessionParticipantAction`
 * that also powers:
 *
 *   POST /api/session-participant-actions/[action_id]/apply
 *   POST /api/session-participant-actions/[action_id]/retry
 *
 * This route no longer owns participant-mutation logic. It is purely:
 *   1. load participant (store-scope gate)
 *   2. load all actions chronologically
 *   3. load / seed matching `session_participant_action_applies` rows
 *   4. call the shared helper per action
 *   5. collect per-action results and return them
 *
 * The shared helper is the single source of truth for:
 *   - session + business-day + store-scope validation
 *   - per-action_type mutation (still_working / end_now / extend)
 *   - idempotent already-left short-circuit
 *   - last_applied_action_id cursor advance
 *   - audit event emission
 *   - apply-row transition to success/failed with failure_code/message
 *
 * Safety:
 *   - resolveAuthContext + role ∈ {owner, manager}
 *   - store-scope + business-day guarded inside the helper
 *   - idempotent: actions with apply_status='success' are skipped; no
 *     double-mutation path exists
 *   - append-only action log is never mutated
 *   - BLE / settlement / ingest tables untouched
 *
 * Body: `{ participant_id: UUID }`.
 *
 * Response:
 *   {
 *     participant_id,
 *     last_applied_action_id,              // post-batch cursor
 *     applied: Array<{ action_id, action_type, result }>,
 *     skipped: Array<{ action_id, action_type, reason }>,
 *     failed:  Array<{ action_id, action_type, failure_code, failure_message }>,
 *     participant_after: { status, left_at, time_minutes, price_amount,
 *                          extension_count }
 *   }
 *
 * Status: 201 if any action was applied, 200 otherwise. Partial failure
 * still returns 200 or 201 — per-action visibility lives in the body.
 * Hard 4xx/5xx is reserved for route-level errors (auth, bad payload,
 * participant-not-found, DB connection failures).
 */

type ParticipantRow = {
  id: string
  session_id: string
  store_uuid: string
  status: string
  entered_at: string | null
  left_at: string | null
  price_amount: number
  time_minutes: number
  last_applied_action_id: string | null
}

type ActionRow = ApplyActionRow & { acted_at: string }

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can apply participant actions." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const participant_id = typeof body.participant_id === "string" ? body.participant_id.trim() : ""
    if (!participant_id || !isValidUUID(participant_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "participant_id must be a valid UUID." },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. Load participant, scope by store. This is the only "owns this
    //    participant" gate at this layer — further validation (session
    //    status, business day, etc.) lives inside the helper so we
    //    cannot drift from the per-action /apply route.
    const { data: partRaw } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, status, entered_at, left_at, price_amount, time_minutes, last_applied_action_id")
      .eq("id", participant_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!partRaw) {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_FOUND", message: "Participant not found." },
        { status: 404 },
      )
    }
    const part = partRaw as ParticipantRow
    if (part.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Participant does not belong to your store." },
        { status: 403 },
      )
    }

    // 2. Load every action for this participant, chronological. The
    //    helper handles already-applied short-circuits so we do NOT
    //    try to compute the pending slice ourselves — that was the
    //    old route's implicit second-source-of-truth.
    const { data: actionRowsRaw, error: actErr } = await supabase
      .from("session_participant_actions")
      .select("id, participant_id, session_id, store_uuid, action_type, acted_at, effective_at, extension_count")
      .eq("store_uuid", auth.store_uuid)
      .eq("participant_id", participant_id)
      .order("acted_at", { ascending: true })
    if (actErr) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: `Failed to load action log: ${actErr.message}` },
        { status: 500 },
      )
    }
    const actions = (actionRowsRaw ?? []) as ActionRow[]

    // 3. Bulk-load existing apply rows for all actions so the main
    //    loop can dispatch without an N+1 fetch. Missing rows get
    //    seeded as pending inside the loop (mirrors the per-action
    //    /apply route's upsert-on-missing behavior).
    const applyByActionId = new Map<string, ApplyRow>()
    if (actions.length > 0) {
      const ids = actions.map(a => a.id)
      const { data: applyRaw } = await supabase
        .from("session_participant_action_applies")
        .select("id, action_id, apply_status, attempt_count")
        .in("action_id", ids)
      for (const r of (applyRaw ?? []) as Array<ApplyRow & { action_id: string }>) {
        applyByActionId.set(r.action_id, { id: r.id, apply_status: r.apply_status, attempt_count: r.attempt_count })
      }
    }

    const applied: Array<{ action_id: string; action_type: string; result: string }> = []
    const skipped: Array<{ action_id: string; action_type: string; reason: string }> = []
    const failed:  Array<{ action_id: string; action_type: string; failure_code: string; failure_message: string }> = []

    const nowIso = new Date().toISOString()
    let lastExtensionCount: number | null = null

    // 4. Dispatch per action through the shared helper. Chronological
    //    order matters because the helper consults current participant
    //    state (e.g., `end_now` sets status='left' which causes the
    //    next `extend` on the same participant to short-circuit to
    //    already_applied — which is exactly the semantic we want).
    for (const action of actions) {
      let existingApply = applyByActionId.get(action.id) ?? null

      // Seed / touch the apply row BEFORE the helper runs so that a
      // failure path inside the helper (writeFailure) has a row to
      // update. The per-action /apply route performs the identical
      // seed/touch; we mirror it exactly to keep apply-row lifecycle
      // semantics uniform across both entry points.
      if (!existingApply) {
        const { data: created } = await supabase
          .from("session_participant_action_applies")
          .insert({
            action_id: action.id,
            participant_id: action.participant_id,
            apply_status: "pending",
            requested_by: auth.membership_id,
            attempt_count: 1,
            last_attempted_at: nowIso,
          })
          .select("id, apply_status, attempt_count")
          .single()
        if (created) {
          existingApply = created as ApplyRow
          applyByActionId.set(action.id, existingApply)
        }
      } else if (existingApply.apply_status !== "success") {
        // Update last_attempted_at only. Attempt_count is NOT bumped
        // here — /retry is the explicit re-attempt surface; batch
        // apply is "continue until done" semantics identical to the
        // single-action /apply route.
        await supabase
          .from("session_participant_action_applies")
          .update({ last_attempted_at: nowIso })
          .eq("id", existingApply.id)
      }

      const outcome = await applySessionParticipantAction({
        supabase,
        auth,
        action,
        existingApply,
      })

      if (outcome.ok) {
        if (outcome.already_applied) {
          skipped.push({
            action_id: action.id,
            action_type: action.action_type,
            reason: "already_applied",
          })
        } else {
          applied.push({
            action_id: action.id,
            action_type: action.action_type,
            result: outcome.result,
          })
          if (action.action_type === "extend") {
            lastExtensionCount = action.extension_count
          }
        }
        continue
      }

      // Hard failure. The helper has already written apply_status='failed'
      // with failure_code / failure_message on the apply row, so the
      // monitor badge will flip to 반영 실패 on the next poll without any
      // further work here. We stop processing subsequent actions because
      // they depend on the same invariants (session active, business day
      // open, store scope, participant existence) — iterating would
      // simply produce N identical failures and N extra writes.
      failed.push({
        action_id: action.id,
        action_type: action.action_type,
        failure_code: outcome.code,
        failure_message: outcome.message,
      })
      break
    }

    // 5. Fresh participant snapshot for the response. The cursor is
    //    whatever the helper committed (possibly unchanged if nothing
    //    actually mutated).
    const { data: afterRaw } = await supabase
      .from("session_participants")
      .select("id, status, left_at, price_amount, time_minutes, last_applied_action_id")
      .eq("id", participant_id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    const after = (afterRaw ?? null) as Partial<ParticipantRow> | null

    return NextResponse.json(
      {
        participant_id,
        last_applied_action_id: after?.last_applied_action_id ?? part.last_applied_action_id,
        applied,
        skipped,
        failed,
        participant_after: {
          status: after?.status ?? part.status,
          left_at: after?.left_at ?? part.left_at,
          time_minutes: after?.time_minutes ?? part.time_minutes,
          price_amount: after?.price_amount ?? part.price_amount,
          extension_count: lastExtensionCount ?? 0,
        },
      },
      { status: applied.length > 0 ? 201 : 200 },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      const status =
        e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
