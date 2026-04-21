import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveBleAnalyticsScope, readBleAnalyticsFilters } from "@/lib/analytics/resolveBleScope"
import { analyticsSupa, fetchBleAnalyticsData } from "@/lib/analytics/fetchBleAnalyticsData"

/**
 * GET /api/ops/ble-analytics/logs
 *
 * Merged + paginated log of corrections and feedback rows for the
 * window + filters. Enriches each row with store / room / floor /
 * worker / actor name via batched lookups (store-scoped).
 *
 * Query: `page` (1-based), `page_size` (default 50, max 200).
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const scope = resolveBleAnalyticsScope(auth, request)
    if (!scope.ok) return scope.error
    const f = readBleAnalyticsFilters(request)

    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("page_size") || "50", 10) || 50))

    const supabase = analyticsSupa()
    const { corrections, feedback } = await fetchBleAnalyticsData(supabase, scope.storeFilter, f)

    // Merge into one log stream ordered by timestamp desc.
    type LogRow = {
      id: string
      at: string
      kind: "correction" | "feedback"
      feedback_type: "positive" | "negative" | null
      membership_id: string | null
      store_uuid: string | null
      original_zone: string | null
      corrected_zone: string | null
      original_room_uuid: string | null
      corrected_room_uuid: string | null
      room_uuid: string | null
      zone: string | null
      gateway_id: string | null
      reason: string | null
      note: string | null
      actor_membership_id: string | null
      source: string | null
    }
    const merged: LogRow[] = []
    for (const c of corrections) {
      merged.push({
        id: `corr:${c.id}`,
        at: c.corrected_at,
        kind: "correction",
        feedback_type: null,
        membership_id: c.membership_id,
        store_uuid: c.store_uuid,
        original_zone: c.original_zone,
        corrected_zone: c.corrected_zone,
        original_room_uuid: c.original_room_uuid,
        corrected_room_uuid: c.corrected_room_uuid,
        room_uuid: null,
        zone: null,
        gateway_id: c.gateway_id,
        reason: c.reason,
        note: c.note,
        actor_membership_id: c.corrected_by_membership_id,
        source: null,
      })
    }
    for (const r of feedback) {
      merged.push({
        id: `fb:${r.id}`,
        at: r.created_at,
        kind: "feedback",
        feedback_type: r.feedback_type === "positive" || r.feedback_type === "negative" ? r.feedback_type : null,
        membership_id: r.membership_id,
        store_uuid: r.store_uuid,
        original_zone: null,
        corrected_zone: null,
        original_room_uuid: null,
        corrected_room_uuid: null,
        room_uuid: r.room_uuid,
        zone: r.zone,
        gateway_id: r.gateway_id,
        reason: null,
        note: r.note,
        actor_membership_id: r.by_membership_id,
        source: r.source,
      })
    }
    merged.sort((a, b) => b.at.localeCompare(a.at))
    const total = merged.length
    const start = (page - 1) * pageSize
    const paged = merged.slice(start, start + pageSize)

    // Enrichment lookups (batched).
    const memberIds = new Set<string>()
    const roomIds = new Set<string>()
    const storeIds = new Set<string>()
    for (const r of paged) {
      if (r.membership_id) memberIds.add(r.membership_id)
      if (r.actor_membership_id) memberIds.add(r.actor_membership_id)
      for (const rid of [r.original_room_uuid, r.corrected_room_uuid, r.room_uuid]) {
        if (rid) roomIds.add(rid)
      }
      if (r.store_uuid) storeIds.add(r.store_uuid)
    }

    const memberNames = new Map<string, string>()
    if (memberIds.size > 0) {
      // Hostess roster for display names. Store-scoped when possible;
      // for super-admin cross-store views we query without store filter
      // since we only return display names.
      let hq = supabase.from("hostesses").select("membership_id, name, stage_name").in("membership_id", Array.from(memberIds)).is("deleted_at", null)
      if (scope.storeFilter) hq = hq.eq("store_uuid", scope.storeFilter)
      const { data: hs } = await hq
      for (const h of (hs ?? []) as Array<{ membership_id: string; name: string; stage_name: string | null }>) {
        memberNames.set(h.membership_id, h.stage_name?.trim() || h.name)
      }
      // Fill actor names that might not be hostesses (managers / owners).
      const missing = Array.from(memberIds).filter(id => !memberNames.has(id))
      if (missing.length > 0) {
        const { data: mems } = await supabase.from("store_memberships")
          .select("id, profile_id")
          .in("id", missing)
        const profileIds = (mems ?? []).map((m: { profile_id: string }) => m.profile_id)
        if (profileIds.length > 0) {
          const { data: profs } = await supabase.from("profiles")
            .select("id, full_name, display_name")
            .in("id", profileIds)
          const nameByProfile = new Map<string, string>()
          for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; display_name: string | null }>) {
            const label = (p.display_name ?? p.full_name ?? "").trim()
            if (label) nameByProfile.set(p.id, label)
          }
          for (const m of (mems ?? []) as Array<{ id: string; profile_id: string }>) {
            const lbl = nameByProfile.get(m.profile_id)
            if (lbl) memberNames.set(m.id, lbl)
          }
        }
      }
    }

    const roomInfo = new Map<string, { room_name: string | null; floor_no: number | null; store_uuid: string }>()
    if (roomIds.size > 0) {
      const { data: rs } = await supabase.from("rooms")
        .select("id, room_name, floor_no, store_uuid")
        .in("id", Array.from(roomIds))
        .is("deleted_at", null)
      for (const r of (rs ?? []) as Array<{ id: string; room_name: string | null; floor_no: number | null; store_uuid: string }>) {
        roomInfo.set(r.id, { room_name: r.room_name, floor_no: r.floor_no, store_uuid: r.store_uuid })
      }
    }

    const storeNames = new Map<string, string>()
    if (storeIds.size > 0) {
      const { data: ss } = await supabase.from("stores").select("id, store_name").in("id", Array.from(storeIds)).is("deleted_at", null)
      for (const s of (ss ?? []) as Array<{ id: string; store_name: string }>) storeNames.set(s.id, s.store_name)
    }

    const enriched = paged.map(r => {
      const room = r.kind === "correction"
        ? (r.original_room_uuid ? roomInfo.get(r.original_room_uuid) : null)
        : (r.room_uuid ? roomInfo.get(r.room_uuid) : null)
      const correctedRoom = r.corrected_room_uuid ? roomInfo.get(r.corrected_room_uuid) ?? null : null
      return {
        id: r.id,
        at: r.at,
        kind: r.kind,
        feedback_type: r.feedback_type,
        membership: r.membership_id
          ? { id: r.membership_id, display_name: memberNames.get(r.membership_id) ?? null }
          : null,
        floor_no: room?.floor_no ?? correctedRoom?.floor_no ?? null,
        store_name: r.store_uuid ? storeNames.get(r.store_uuid) ?? null : null,
        original: {
          zone: r.original_zone ?? r.zone ?? null,
          room_name: room?.room_name ?? null,
        },
        corrected: r.kind === "correction"
          ? {
              zone: r.corrected_zone ?? null,
              room_name: correctedRoom?.room_name ?? null,
            }
          : null,
        reason: r.reason,
        note: r.note,
        actor: r.actor_membership_id
          ? { id: r.actor_membership_id, display_name: memberNames.get(r.actor_membership_id) ?? null }
          : null,
        gateway_id: r.gateway_id,
        source: r.source,
      }
    })

    return NextResponse.json({
      window: { from: f.from, to: f.to },
      scope: { storeFilter: scope.storeFilter, isSuperAdmin: scope.isSuperAdmin, role: scope.role },
      page, page_size: pageSize, total,
      rows: enriched,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
