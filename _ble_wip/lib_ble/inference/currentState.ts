import type { BleZoneStateValue, BleZoneType } from "./applyZoneInference";

export const CURRENT_STATE_SELECT_COLUMNS = [
  "store_uuid",
  "hostess_id",
  "beacon_minor",
  "floor_no",
  "zone_id",
  "zone_type",
  "room_uuid",
  "state",
  "consecutive_windows",
  "first_entered_at",
  "last_seen_at",
] as const;

export const CURRENT_STATE_UPSERT_COLUMNS = [
  "store_uuid",
  "hostess_id",
  "beacon_minor",
  "floor_no",
  "zone_id",
  "zone_type",
  "room_uuid",
  "state",
  "confidence",
  "floor_confidence",
  "zone_confidence",
  "competing_zone_id",
  "hit_count",
  "consecutive_windows",
  "first_entered_at",
  "last_seen_at",
  "last_transition_at",
  "window_started_at",
  "window_ended_at",
  "meta",
] as const;

type DecisionLike = {
  hostess_id: string;
  beacon_minor: number;
  floor_no: number | null;
  zone_id: string | null;
  zone_type: BleZoneType;
  room_uuid: string | null;
  state: BleZoneStateValue;
  confidence: number;
  floor_confidence: number;
  zone_confidence: number;
  competing_zone_id: string | null;
  hit_count: number;
  consecutive_windows: number;
  first_entered_at: string | null;
  last_seen_at: string;
  last_transition_at: string;
  window_started_at: string;
  window_ended_at: string;
  meta: Record<string, unknown>;
};

export function buildCurrentStateUpsertRows(
  storeUuid: string,
  decisions: ReadonlyArray<DecisionLike>
) {
  return decisions.map((decision) => ({
    store_uuid: storeUuid,
    hostess_id: decision.hostess_id,
    beacon_minor: decision.beacon_minor,
    floor_no: decision.floor_no,
    zone_id: decision.zone_id,
    zone_type: decision.zone_type,
    room_uuid: decision.room_uuid,
    state: decision.state,
    confidence: decision.confidence,
    floor_confidence: decision.floor_confidence,
    zone_confidence: decision.zone_confidence,
    competing_zone_id: decision.competing_zone_id,
    hit_count: decision.hit_count,
    consecutive_windows: decision.consecutive_windows,
    first_entered_at: decision.first_entered_at,
    last_seen_at: decision.last_seen_at,
    last_transition_at: decision.last_transition_at,
    window_started_at: decision.window_started_at,
    window_ended_at: decision.window_ended_at,
    meta: decision.meta,
  }));
}
