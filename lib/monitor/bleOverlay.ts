/**
 * Counter Monitor — BLE presence overlay.
 *
 * 2026-05-03: app/api/counter/monitor/route.ts 분할.
 *
 * 정책 (절대 위반 금지):
 *   - 매장 scope (store_uuid 일치) 만.
 *   - active tag + resolvable home-store membership 만 노출.
 *   - foreign hostess 는 active local session 의 participant 가 아니면 BLE
 *     reading 무시 (rule 11-13).
 *   - presence 는 **표시 overlay 만** — participants/sessions/time_segments/
 *     settlements 에 절대 영향 X.
 *   - Human correction overlay 는 raw `ble_tag_presence` 를 절대 수정하지 않음.
 *
 * Zone 도출:
 *   gateway_type 컬럼 ('room' | 'counter' | 'restroom' | 'elevator' |
 *   'external_floor' | 'lounge') 기준. 미상 / 모름은 'unknown'.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computePresenceConfidence,
  buildConfidenceContextByMember,
  type CorrectionHistoryRow,
} from "@/lib/ble/computePresenceConfidence"

export type BleZone =
  | "room" | "counter" | "restroom" | "elevator"
  | "external_floor" | "lounge" | "unknown"

export type BlePresenceOut = {
  membership_id: string
  display_name: string
  zone: BleZone
  room_uuid: string | null
  last_seen_at: string
  last_event_type: string | null
  /** "ble" = raw BLE reading; "corrected" = human correction overlay. */
  source: "ble" | "corrected"
  corrected_by_membership_id?: string | null
  corrected_at?: string | null
  confidence_level?: "high" | "medium" | "low"
  confidence_score?: number
  confidence_reasons?: string[]
}

const RECOGNIZED_ZONES: ReadonlyArray<BleZone> = [
  "room", "counter", "restroom", "elevator", "external_floor", "lounge",
] as const

function mapZone(gt: string | null | undefined, hasRoom: boolean): BleZone {
  if (!gt) return hasRoom ? "room" : "unknown"
  if ((RECOGNIZED_ZONES as ReadonlyArray<string>).includes(gt)) return gt as BleZone
  return hasRoom ? "room" : "unknown"
}

export type BleOverlayInput = {
  storeUuid: string
  homeHostesses: Array<{ membership_id: string }>
  homeNameMap: Map<string, string>
  participants: Array<{ id: string; membership_id: string | null }>
  activeSessions: Array<{ id: string }>
}

export type BleOverlayResult = {
  blePresence: BlePresenceOut[]
  bleConfidence: "manual" | "hybrid"
  /** restroom / external_floor 카운트 (BLE 가 'hybrid' 일 때만 의미). */
  zoneSummaryDelta: { restroom: number; external_floor: number } | null
}

export async function buildBleOverlay(
  supabase: SupabaseClient,
  input: BleOverlayInput,
): Promise<BleOverlayResult> {
  const { storeUuid, homeHostesses, homeNameMap, participants, activeSessions } = input
  let blePresence: BlePresenceOut[] = []
  let bleConfidence: "manual" | "hybrid" = "manual"

  try {
    const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: presRows } = await supabase
      .from("ble_tag_presence")
      .select("minor, room_uuid, membership_id, last_event_type, last_seen_at")
      .eq("store_uuid", storeUuid)
      .gt("last_seen_at", cutoffIso)
    const presList = (presRows ?? []) as Array<{
      minor: number
      room_uuid: string | null
      membership_id: string | null
      last_event_type: string | null
      last_seen_at: string
    }>

    if (presList.length > 0) {
      const allowedMemberships = new Set(homeHostesses.map(h => h.membership_id))

      const bleRoomUuids = Array.from(
        new Set(presList.map(p => p.room_uuid).filter((r): r is string => !!r)),
      )
      const gatewayTypeByRoom = new Map<string, string>()
      if (bleRoomUuids.length > 0) {
        const { data: gwRows } = await supabase
          .from("ble_gateways")
          .select("room_uuid, gateway_type")
          .eq("store_uuid", storeUuid)
          .in("room_uuid", bleRoomUuids)
          .eq("is_active", true)
        for (const g of (gwRows ?? []) as Array<{ room_uuid: string | null; gateway_type: string | null }>) {
          if (g.room_uuid) gatewayTypeByRoom.set(g.room_uuid, g.gateway_type ?? "room")
        }
      }

      for (const p of presList) {
        if (!p.membership_id || !allowedMemberships.has(p.membership_id)) continue
        const zone = mapZone(
          p.room_uuid ? gatewayTypeByRoom.get(p.room_uuid) ?? null : null,
          !!p.room_uuid,
        )
        const name = homeNameMap.get(p.membership_id) ?? null
        if (!name) continue
        blePresence.push({
          membership_id: p.membership_id,
          display_name: name,
          zone,
          room_uuid: p.room_uuid,
          last_seen_at: p.last_seen_at,
          last_event_type: p.last_event_type,
          source: "ble",
        })
      }
    }

    // ── Human correction overlay ──────────────────────────────────────
    type CorrRow = {
      membership_id: string
      participant_id: string | null
      session_id: string | null
      corrected_zone: string
      corrected_room_uuid: string | null
      corrected_by_membership_id: string | null
      corrected_at: string
    }
    const { data: corrRaw } = await supabase
      .from("ble_presence_corrections")
      .select("membership_id, participant_id, session_id, corrected_zone, corrected_room_uuid, corrected_by_membership_id, corrected_at")
      .eq("store_uuid", storeUuid)
      .eq("is_active", true)
      .order("corrected_at", { ascending: false })
    const corrRows = (corrRaw ?? []) as CorrRow[]

    if (corrRows.length > 0) {
      const activeSessionIdSet = new Set(activeSessions.map(s => s.id))
      const visibleParticipantIdSet = new Set(participants.map(p => p.id))
      const visibleMemberships = new Set<string>()
      for (const h of homeHostesses) visibleMemberships.add(h.membership_id)
      for (const p of participants) {
        if (p.membership_id) visibleMemberships.add(p.membership_id)
      }

      const latestByMember = new Map<string, CorrRow>()
      for (const c of corrRows) {
        if (latestByMember.has(c.membership_id)) continue
        if (!visibleMemberships.has(c.membership_id)) continue
        if (c.participant_id && !visibleParticipantIdSet.has(c.participant_id)) continue
        if (c.session_id && !activeSessionIdSet.has(c.session_id)) continue
        if (!(RECOGNIZED_ZONES as ReadonlyArray<string>).includes(c.corrected_zone)) continue
        latestByMember.set(c.membership_id, c)
      }

      for (const row of blePresence) {
        const c = latestByMember.get(row.membership_id)
        if (!c) continue
        row.zone = c.corrected_zone as BleZone
        row.room_uuid = c.corrected_room_uuid
        row.source = "corrected"
        row.corrected_by_membership_id = c.corrected_by_membership_id
        row.corrected_at = c.corrected_at
        latestByMember.delete(row.membership_id)
      }
      for (const [memberId, c] of latestByMember) {
        const name = homeNameMap.get(memberId) ?? null
        if (!name) continue
        blePresence.push({
          membership_id: memberId,
          display_name: name,
          zone: c.corrected_zone as BleZone,
          room_uuid: c.corrected_room_uuid,
          last_seen_at: c.corrected_at,
          last_event_type: null,
          source: "corrected",
          corrected_by_membership_id: c.corrected_by_membership_id,
          corrected_at: c.corrected_at,
        })
      }
    }

    // ── Confidence fold ─────────────────────────────────────────────
    const corrForContext: CorrectionHistoryRow[] = corrRows.map(c => ({
      membership_id: c.membership_id,
      corrected_zone: c.corrected_zone,
      corrected_room_uuid: c.corrected_room_uuid,
      corrected_at: c.corrected_at,
    }))
    const ctxByMember = buildConfidenceContextByMember(corrForContext)
    const emptyCtx = { recentCorrections: [] as CorrectionHistoryRow[] }
    for (const row of blePresence) {
      const ctx = ctxByMember.get(row.membership_id) ?? emptyCtx
      const c = computePresenceConfidence(
        {
          membership_id: row.membership_id,
          zone: row.zone,
          room_uuid: row.room_uuid,
          last_seen_at: row.last_seen_at,
          source: row.source,
        },
        ctx,
      )
      row.confidence_level = c.level
      row.confidence_score = c.score
      row.confidence_reasons = c.reasons
    }

    if (blePresence.length > 0) {
      bleConfidence = "hybrid"
      const restroom = blePresence.filter(b => b.zone === "restroom").length
      const external_floor = blePresence.filter(b => b.zone === "external_floor").length
      return { blePresence, bleConfidence, zoneSummaryDelta: { restroom, external_floor } }
    }
  } catch {
    // 어떤 오류든 manual 로 fallback. BLE 실패가 monitor 본 응답을 깨면 안 됨.
    blePresence = []
    bleConfidence = "manual"
  }

  return { blePresence, bleConfidence, zoneSummaryDelta: null }
}
