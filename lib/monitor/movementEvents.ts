/**
 * Counter Monitor — recent movement events (read-only).
 *
 * 2026-05-03: app/api/counter/monitor/route.ts 분할.
 *   audit_events 의 state-affecting session actions 만 fetch.
 *   manual sources only — BLE / 추정 데이터 절대 포함하지 않음.
 *
 * 정책:
 *   - 매장 scope (store_uuid 일치) 만.
 *   - 가장 최근 20건.
 *   - 실패 시 빈 배열 (silent — 모니터 본 데이터에 영향 없도록).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type MovementEvent = {
  at: string
  kind: string
  actor_role: string | null
  entity_table: string | null
  entity_id: string | null
  room_uuid: string | null
  session_id: string | null
}

const TRACKED_ACTIONS = [
  "session_checkin",
  "session_checkout",
  "participant_added",
  "participant_mid_out",
  "participant_deleted",
]

export async function fetchRecentMovement(
  supabase: SupabaseClient,
  storeUuid: string,
): Promise<MovementEvent[]> {
  try {
    const { data: auditRows } = await supabase
      .from("audit_events")
      .select("created_at, action, actor_role, entity_table, entity_id, room_uuid, session_id")
      .eq("store_uuid", storeUuid)
      .in("action", TRACKED_ACTIONS)
      .order("created_at", { ascending: false })
      .limit(20)
    return (auditRows ?? []).map((r: Record<string, unknown>) => ({
      at: String(r.created_at),
      kind: String(r.action),
      actor_role: (r.actor_role as string | null) ?? null,
      entity_table: (r.entity_table as string | null) ?? null,
      entity_id: (r.entity_id as string | null) ?? null,
      room_uuid: (r.room_uuid as string | null) ?? null,
      session_id: (r.session_id as string | null) ?? null,
    }))
  } catch {
    return []
  }
}
