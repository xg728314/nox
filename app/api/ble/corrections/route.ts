import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { evaluateCorrectionGuard, type CorrectionGuardWarning } from "@/lib/ble/correctionGuard"

/**
 * POST /api/ble/corrections
 *
 * Human correction overlay for BLE presence. Writes ONLY to
 * `ble_presence_corrections`. This route never touches BLE raw tables
 * (`ble_ingest_events`, `ble_tag_presence`, `ble_tags`, `ble_gateways`),
 * session/participant/settlement tables, or any transactional flow.
 *
 * Auth / scope:
 *   - `resolveAuthContext` → role ∈ {owner, manager}.
 *   - store_uuid enforced on every read and on the insert payload.
 *   - membership_id must belong to a worker visible in the caller's
 *     store — either a home-store hostess OR a currently active
 *     cross-store participant in caller's store.
 *   - optional participant_id / session_id / room uuids are each
 *     validated to belong to the caller's store.
 *
 * Zone contract (matches monitor / zones.ts):
 *   room | counter | restroom | elevator | external_floor
 *
 *   - corrected_zone === "room"  ⇒ corrected_room_uuid REQUIRED
 *   - corrected_zone !== "room"  ⇒ corrected_room_uuid must be null
 *
 * Response: `{ ok, correction_id, applied_overlay: { membership_id,
 *            corrected_zone, corrected_room_uuid } }`. The monitor's
 * next poll reflects the overlay; no response-level mutation is
 * required on the client.
 */

const ZONES = ["room", "counter", "restroom", "elevator", "external_floor"] as const
type Zone = typeof ZONES[number]

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
        { error: "ROLE_FORBIDDEN", message: "Only owner/manager can record BLE corrections." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const membership_id       = typeof body.membership_id === "string" ? body.membership_id.trim() : ""
    const participant_id_raw  = typeof body.participant_id === "string" ? body.participant_id.trim() : null
    const session_id_raw      = typeof body.session_id === "string" ? body.session_id.trim() : null
    const original_zone       = typeof body.original_zone === "string" ? body.original_zone.trim() : ""
    const corrected_zone_raw  = typeof body.corrected_zone === "string" ? body.corrected_zone.trim() : ""
    const original_room_uuid  = typeof body.original_room_uuid === "string" && body.original_room_uuid.length > 0 ? body.original_room_uuid.trim() : null
    const corrected_room_uuid = typeof body.corrected_room_uuid === "string" && body.corrected_room_uuid.length > 0 ? body.corrected_room_uuid.trim() : null
    const ble_presence_seen_at = typeof body.ble_presence_seen_at === "string" ? body.ble_presence_seen_at : null
    const gateway_id          = typeof body.gateway_id === "string" ? body.gateway_id.trim().slice(0, 120) : null
    const reason              = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : null
    const note                = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null

    if (!membership_id || !isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id must be a valid UUID." }, { status: 400 })
    }
    if (!original_zone) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "original_zone is required." }, { status: 400 })
    }
    if (!(ZONES as ReadonlyArray<string>).includes(corrected_zone_raw)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `corrected_zone must be one of ${ZONES.join("|")}` },
        { status: 400 },
      )
    }
    const corrected_zone = corrected_zone_raw as Zone

    if (corrected_zone === "room") {
      if (!corrected_room_uuid || !isValidUUID(corrected_room_uuid)) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "corrected_room_uuid is required when corrected_zone='room'." },
          { status: 400 },
        )
      }
    } else if (corrected_room_uuid !== null) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "corrected_room_uuid must be null when corrected_zone is not 'room'." },
        { status: 400 },
      )
    }
    if (original_room_uuid && !isValidUUID(original_room_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "original_room_uuid must be a valid UUID." }, { status: 400 })
    }
    if (participant_id_raw && !isValidUUID(participant_id_raw)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "participant_id must be a valid UUID." }, { status: 400 })
    }
    if (session_id_raw && !isValidUUID(session_id_raw)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id must be a valid UUID." }, { status: 400 })
    }

    const supabase = supa()

    // 1. Membership visibility: home hostess OR active participant in this store.
    const { data: homeHostess } = await supabase
      .from("hostesses")
      .select("membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("membership_id", membership_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!homeHostess) {
      const { data: foreignPart } = await supabase
        .from("session_participants")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("membership_id", membership_id)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()
      if (!foreignPart) {
        return NextResponse.json(
          { error: "MEMBERSHIP_NOT_VISIBLE", message: "Membership is not visible in your store context." },
          { status: 403 },
        )
      }
    }

    // 2. corrected_room_uuid → must belong to caller's store.
    if (corrected_room_uuid) {
      const { data: room } = await supabase
        .from("rooms")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("id", corrected_room_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!room) {
        return NextResponse.json({ error: "ROOM_NOT_FOUND", message: "corrected_room_uuid not found in your store." }, { status: 404 })
      }
    }
    if (original_room_uuid) {
      const { data: oroom } = await supabase
        .from("rooms")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("id", original_room_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!oroom) {
        return NextResponse.json({ error: "ROOM_NOT_FOUND", message: "original_room_uuid not found in your store." }, { status: 404 })
      }
    }

    // 3. participant / session scope check.
    if (participant_id_raw) {
      const { data: p } = await supabase
        .from("session_participants")
        .select("id, session_id")
        .eq("id", participant_id_raw)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!p) {
        return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND" }, { status: 404 })
      }
      if (session_id_raw && p.session_id !== session_id_raw) {
        return NextResponse.json({ error: "SESSION_MISMATCH" }, { status: 400 })
      }
    }
    if (session_id_raw) {
      const { data: s } = await supabase
        .from("room_sessions")
        .select("id")
        .eq("id", session_id_raw)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!s) {
        return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
      }
    }

    // 4. Abuse / data-quality guardrails. Shared helper evaluates:
    //    - same-target cooldown (hard block)
    //    - actor burst (soft warning)
    //    - flip-flop pattern (soft warning)
    //    Block is returned as 429 so the client can distinguish rate-
    //    limited from other failures. Warnings are attached to the
    //    success response; the insert still proceeds.
    let guardWarning: CorrectionGuardWarning | null = null
    const guard = await evaluateCorrectionGuard({
      supabase,
      store_uuid: auth.store_uuid,
      actor_membership_id: auth.membership_id,
      target_membership_id: membership_id,
      next_zone: corrected_zone,
    })
    if (guard.decision === "block") {
      return NextResponse.json(
        {
          ok: false,
          error: guard.code,
          message: guard.message,
          retry_after_ms: guard.retry_after_ms,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(guard.retry_after_ms / 1000)),
          },
        },
      )
    }
    if (guard.decision === "allow_with_warning") {
      guardWarning = guard.warning
    }

    const insertPayload = {
      store_uuid: auth.store_uuid,
      membership_id,
      session_id: session_id_raw,
      participant_id: participant_id_raw,
      original_zone: original_zone.slice(0, 40),
      corrected_zone,
      original_room_uuid,
      corrected_room_uuid,
      ble_presence_seen_at,
      corrected_by_membership_id: auth.membership_id,
      gateway_id,
      reason,
      note,
      is_active: true,
    }

    const { data: inserted, error: insErr } = await supabase
      .from("ble_presence_corrections")
      .insert(insertPayload)
      .select("id")
      .single()
    if (insErr || !inserted) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr?.message }, { status: 500 })
    }

    // Auto-emit a negative feedback row so the KPI / accuracy widgets
    // count this correction as a "BLE got it wrong" signal. Fire-and-
    // forget — a failure here never blocks the correction response
    // because the correction itself is the primary artifact.
    try {
      await supabase.from("ble_feedback").insert({
        store_uuid: auth.store_uuid,
        membership_id,
        session_id: session_id_raw,
        participant_id: participant_id_raw,
        feedback_type: "negative",
        zone: original_zone.slice(0, 40),
        room_uuid: original_room_uuid,
        gateway_id,
        source: "correction_auto",
        note: reason ? `auto: ${reason}` : "auto: correction",
        by_membership_id: auth.membership_id,
      })
    } catch { /* best-effort */ }

    return NextResponse.json(
      {
        ok: true,
        correction_id: inserted.id,
        applied_overlay: {
          membership_id,
          corrected_zone,
          corrected_room_uuid,
        },
        // Soft warning from the guard (burst / flip-flop). Null when
        // the write was fully clean. UI surfaces the message so the
        // operator is aware without blocking the action.
        warning: guardWarning,
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
