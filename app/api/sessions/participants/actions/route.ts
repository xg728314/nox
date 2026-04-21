import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { isValidUUID } from "@/lib/validation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * POST /api/sessions/participants/actions
 *
 * Human operator action layer for /counter/monitor. Writes to
 * `session_participant_actions` only — NEVER touches session_participants,
 * room_sessions, participant_time_segments, receipts, or settlements.
 *
 * Actions:
 *   still_working : operator dismisses repeat absence alerts for a
 *                   participant. Does NOT change session/participant
 *                   status. Pure alert mute.
 *   end_now       : operator records that the participant is finished
 *                   as of now. Does NOT backdate. Does NOT mutate
 *                   session_participants — /counter checkout remains the
 *                   authoritative end-of-participant path. Monitor
 *                   derives visibility and hides the row on next poll.
 *   extend        : increment extension_count. Does NOT mutate participant
 *                   time_minutes — the /counter extend flow handles
 *                   billable extension. This action records the operator
 *                   decision for audit + monitor badge display.
 *
 * Auth: owner / manager only. Store scope enforced from the participant's
 * session's store_uuid matching auth.store_uuid. Business day must be open.
 *
 * BLE: forbidden as a caller. All callers must be authenticated users
 * with an approved store_membership. Gateway secrets are never accepted.
 */

const ACTION_TYPES = ["still_working", "end_now", "extend"] as const
type ActionType = typeof ACTION_TYPES[number]

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can record operator actions." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const participant_id = typeof body.participant_id === "string" ? body.participant_id.trim() : ""
    const action = typeof body.action === "string" ? body.action.trim() : ""
    const rawNote = body.note
    const note =
      typeof rawNote === "string" && rawNote.trim().length > 0
        ? rawNote.trim().slice(0, 500)
        : null

    if (!participant_id || !isValidUUID(participant_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "participant_id must be a valid UUID." },
        { status: 400 },
      )
    }
    if (!(ACTION_TYPES as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `action must be one of ${ACTION_TYPES.join("|")}` },
        { status: 400 },
      )
    }

    const supabase = supa()

    // Validate participant + store scope.
    const { data: part, error: partErr } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, status")
      .eq("id", participant_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (partErr || !part) {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_FOUND", message: "Participant not found." },
        { status: 404 },
      )
    }
    if (part.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Participant does not belong to your store." },
        { status: 403 },
      )
    }

    // Validate session active + store scope.
    const { data: sess } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status, business_day_id")
      .eq("id", part.session_id)
      .maybeSingle()
    if (!sess) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (sess.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_MISMATCH" }, { status: 403 })
    }
    if (sess.status !== "active") {
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: "Session is not active." },
        { status: 409 },
      )
    }

    // Business day closure guard (same pattern as other mutation routes).
    const dayGuard = await assertBusinessDayOpen(supabase, sess.business_day_id)
    if (dayGuard) return dayGuard

    const nowIso = new Date().toISOString()
    const actionTyped = action as ActionType

    // For 'extend', look at the latest action row to increment its count.
    // 'still_working' and 'end_now' don't carry an extension count.
    let extension_count: number | null = null
    if (actionTyped === "extend") {
      const { data: prev } = await supabase
        .from("session_participant_actions")
        .select("extension_count, action_type")
        .eq("store_uuid", auth.store_uuid)
        .eq("participant_id", participant_id)
        .order("acted_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const prevCount =
        prev?.action_type === "extend" ? (prev.extension_count ?? 0) : 0
      extension_count = prevCount + 1
    }

    const { data: inserted, error: insErr } = await supabase
      .from("session_participant_actions")
      .insert({
        store_uuid: auth.store_uuid,
        session_id: part.session_id,
        participant_id,
        action_type: actionTyped,
        acted_by_membership_id: auth.membership_id,
        acted_at: nowIso,
        effective_at: nowIso,
        note,
        extension_count,
      })
      .select("id")
      .single()
    if (insErr || !inserted) {
      return NextResponse.json(
        { error: "INSERT_FAILED", message: insErr?.message ?? "insert failed" },
        { status: 500 },
      )
    }

    // Create the matching apply-tracking row (pending, attempt_count=1).
    // Best-effort: a failure here never invalidates the action record,
    // since the /apply endpoint also upserts the tracking row on-demand.
    try {
      await supabase.from("session_participant_action_applies").insert({
        action_id: inserted.id,
        participant_id,
        apply_status: "pending",
        requested_by: auth.membership_id,
        attempt_count: 1,
        last_attempted_at: nowIso,
      })
    } catch { /* best-effort */ }

    const operator_status =
      actionTyped === "still_working" ? "still_working" :
      actionTyped === "end_now" ? "ended" :
      "extended"

    return NextResponse.json(
      {
        ok: true,
        participant_id,
        action_id: inserted.id,
        operator_status,
        extension_count: extension_count ?? 0,
        acted_at: nowIso,
      },
      { status: 201 },
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
