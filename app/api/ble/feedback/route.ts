import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * POST /api/ble/feedback
 *
 * Lightweight accuracy feedback tap. Writes exactly one row to
 * `ble_feedback`. Does not touch BLE raw tables, session / participant
 * / settlement tables, or corrections. Zero business impact.
 *
 * Body: `{
 *   membership_id: string,
 *   feedback_type: "positive" | "negative",
 *   participant_id?: string | null,
 *   session_id?: string | null,
 *   zone?: string | null,
 *   room_uuid?: string | null,
 *   gateway_id?: string | null,
 *   note?: string | null,
 *   source?: "manual_tap" | "correction_auto"
 * }`
 */

const FEEDBACK_TYPES = ["positive", "negative"] as const
const VALID_SOURCES = ["manual_tap", "correction_auto"] as const

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
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can submit BLE feedback." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const membership_id    = typeof body.membership_id === "string" ? body.membership_id.trim() : ""
    const feedback_type    = typeof body.feedback_type === "string" ? body.feedback_type.trim() : ""
    const participant_id   = typeof body.participant_id === "string" && body.participant_id.length > 0 ? body.participant_id.trim() : null
    const session_id       = typeof body.session_id === "string" && body.session_id.length > 0 ? body.session_id.trim() : null
    const room_uuid        = typeof body.room_uuid === "string" && body.room_uuid.length > 0 ? body.room_uuid.trim() : null
    const zone             = typeof body.zone === "string" && body.zone.length > 0 ? body.zone.trim().slice(0, 40) : null
    const gateway_id       = typeof body.gateway_id === "string" && body.gateway_id.length > 0 ? body.gateway_id.trim().slice(0, 120) : null
    const note             = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null
    const source_raw       = typeof body.source === "string" ? body.source.trim() : "manual_tap"
    const source = (VALID_SOURCES as ReadonlyArray<string>).includes(source_raw) ? source_raw : "manual_tap"

    if (!membership_id || !isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }
    if (!(FEEDBACK_TYPES as ReadonlyArray<string>).includes(feedback_type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "feedback_type must be 'positive' or 'negative'." }, { status: 400 })
    }
    if (participant_id && !isValidUUID(participant_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "participant_id must be a valid UUID." }, { status: 400 })
    }
    if (session_id && !isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id must be a valid UUID." }, { status: 400 })
    }
    if (room_uuid && !isValidUUID(room_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "room_uuid must be a valid UUID." }, { status: 400 })
    }

    const supabase = supa()

    // Visibility gate: membership must be a home hostess OR a
    // currently-active foreign participant in caller's store — same
    // rule as the corrections route.
    const { data: homeRow } = await supabase
      .from("hostesses")
      .select("membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("membership_id", membership_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!homeRow) {
      const { data: foreignP } = await supabase
        .from("session_participants")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("membership_id", membership_id)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()
      if (!foreignP) {
        return NextResponse.json({ error: "MEMBERSHIP_NOT_VISIBLE" }, { status: 403 })
      }
    }

    // Optional scope checks — participant/session/room must belong to caller's store.
    if (participant_id) {
      const { data: p } = await supabase
        .from("session_participants")
        .select("id")
        .eq("id", participant_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!p) return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND" }, { status: 404 })
    }
    if (session_id) {
      const { data: s } = await supabase
        .from("room_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!s) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (room_uuid) {
      const { data: r } = await supabase
        .from("rooms")
        .select("id")
        .eq("id", room_uuid)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!r) return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 })
    }

    const { data: inserted, error: insErr } = await supabase
      .from("ble_feedback")
      .insert({
        store_uuid: auth.store_uuid,
        membership_id,
        session_id,
        participant_id,
        feedback_type,
        zone,
        room_uuid,
        gateway_id,
        source,
        note,
        by_membership_id: auth.membership_id,
      })
      .select("id")
      .single()
    if (insErr || !inserted) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr?.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, feedback_id: inserted.id }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
