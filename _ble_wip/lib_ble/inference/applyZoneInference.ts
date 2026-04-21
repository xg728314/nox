import type { SupabaseClient } from "@supabase/supabase-js";
import type { BleIngestEventInput } from "@/lib/ble/ingest/parseBleIngestPayload";
import { isDebugBleInferenceEnabled } from "@/lib/debug/serverDebug";
import {
  buildCurrentStateUpsertRows,
  CURRENT_STATE_SELECT_COLUMNS,
  CURRENT_STATE_UPSERT_COLUMNS,
} from "@/lib/ble/inference/currentState";

export type BleZoneType = "room" | "corridor" | "counter" | "stairs_elevator" | "unknown";
export type BleZoneStateValue = "enter_pending" | "stay" | "exit_pending";

type GatewayZoneRow = {
  id: string | null;
  gateway_id: string;
  store_uuid: string | null;
  room_uuid: string | null;
  floor_no: number | null;
  zone_id: string | null;
  zone_type: string | null;
  zone_code: string | null;
};

type GatewayBaseRow = {
  id: string | null;
  gateway_id: string;
  store_uuid: string | null;
  room_uuid: string | null;
  floor_no: number | null;
  zone_id: string | null;
};

type ZoneRow = {
  id: string;
  store_uuid: string | null;
  floor_no: number | null;
  zone_type: string | null;
  zone_code: string | null;
  room_uuid: string | null;
  is_active: boolean | null;
};

type TagRow = {
  beacon_minor: number;
  hostess_id: string | null;
  is_active: boolean | null;
};

type WindowEventRow = {
  gateway_id: string;
  beacon_minor: number;
  event_type: string;
  rssi: number | null;
  observed_at: string;
};

type CurrentZoneStateRow = {
  store_uuid: string;
  hostess_id: string;
  beacon_minor: number | null;
  floor_no: number | null;
  zone_id: string | null;
  zone_type: BleZoneType;
  room_uuid: string | null;
  state: BleZoneStateValue;
  consecutive_windows: number | null;
  first_entered_at: string | null;
  last_seen_at: string;
};

type ActivePresenceRow = {
  id: string;
  hostess_id: string;
  room_uuid: string | null;
  gateway_id: string | null;
};

type RoomInfoRow = {
  id: string;
  room_no: number | null;
  name: string | null;
};

type Aggregate = {
  floor_no: number | null;
  zone_id: string | null;
  zone_code: string | null;
  zone_type: BleZoneType;
  room_uuid: string | null;
  gateway_ids: Set<string>;
  score: number;
  hit_count: number;
  strongest_rssi: number | null;
  latest_seen_at: string;
};

type RankedAggregate = Aggregate & {
  confidence: number;
  margin: number;
};

type CandidateZone = {
  floor_no: number | null;
  zone_id: string | null;
  zone_code: string | null;
  zone_type: BleZoneType;
  room_uuid: string | null;
  best_gateway_id: string | null;
  score: number;
  confidence: number;
  margin: number;
  hit_count: number;
  gateway_count: number;
  last_seen_at: string;
  strongest_rssi: number | null;
  competing_zone_id: string | null;
  competing_zone_code: string | null;
  competing_zone_type: BleZoneType | null;
};

type TagDecision = {
  hostess_id: string;
  beacon_minor: number;
  floor_no: number | null;
  zone_id: string | null;
  zone_code: string | null;
  zone_type: BleZoneType;
  room_uuid: string | null;
  state: BleZoneStateValue;
  confidence: number;
  floor_confidence: number;
  zone_confidence: number;
  competing_zone_id: string | null;
  competing_zone_code: string | null;
  competing_zone_type: BleZoneType | null;
  competing_margin: number | null;
  best_gateway_id: string | null;
  hit_count: number;
  gateway_count: number;
  consecutive_windows: number;
  first_entered_at: string | null;
  last_seen_at: string;
  last_transition_at: string;
  window_started_at: string;
  window_ended_at: string;
  meta: Record<string, unknown>;
};

export type ApplyZoneInferenceArgs = {
  supabase: SupabaseClient;
  storeUuid: string;
  events: BleIngestEventInput[];
  preloadedTags?: TagRow[];
};

export type ApplyZoneInferenceResult = {
  ok: boolean;
  zone_state_updates: number;
  room_presence_updates: number;
  warnings: string[];
  fallback_to_legacy: boolean;
  schema_detected: boolean;
  fallback_reason: string | null;
  affected_hostess_ids: string[];
  beacon_minors: number[];
  gateway_zone_join_count: number;
  candidate_count: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZONE_WINDOW_MS = 10_000;
const EXIT_GRACE_MS = 12_000;
const ACTIVE_ROOM_FRESH_MS = 20_000;
const MIN_FLOOR_HITS = 2;
const MIN_ROOM_HITS = 3;
const MIN_NON_ROOM_HITS = 2;
const MIN_FLOOR_CONFIDENCE = 0.55;
const MIN_FLOOR_MARGIN = 0.15;
const MIN_ROOM_CONFIDENCE = 0.58;
const MIN_ROOM_MARGIN = 0.22;
const MIN_NON_ROOM_CONFIDENCE = 0.52;
const MIN_NON_ROOM_MARGIN = 0.12;
const ROOM_STAY_CONSECUTIVE_WINDOWS = 2;

function logZoneTrace(payload: Record<string, unknown>): void {
  if (!isDebugBleInferenceEnabled()) return;
  console.log("[ZONE_TRACE]", payload);
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function normalizeZoneType(value: unknown, roomUuid: string | null): BleZoneType {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "room" || text === "corridor" || text === "counter" || text === "stairs_elevator" || text === "unknown") {
    return text;
  }
  return roomUuid ? "room" : "unknown";
}

function getErrorInfo(error: unknown) {
  return {
    code: String((error as any)?.code ?? ""),
    message: String((error as any)?.message ?? error ?? ""),
    details: String((error as any)?.details ?? ""),
    hint: String((error as any)?.hint ?? ""),
  };
}

function isMissingTableOrSchemaCache(error: unknown, resourceHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  const missingKind =
    info.code === "PGRST205" ||
    info.code === "42P01" ||
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table");
  return missingKind && resourceHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function isMissingColumn(error: unknown, columnHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  return info.code === "42703" && columnHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeRssi(rssi: number | null): number {
  if (!Number.isFinite(Number(rssi))) return 0.45;
  const bounded = Math.max(-100, Math.min(-35, Math.trunc(Number(rssi))));
  return clamp01((bounded + 100) / 65);
}

function eventScore(event: WindowEventRow, referenceMs: number): number {
  if (event.event_type === "leave") return 0;
  const observedMs = Date.parse(event.observed_at);
  const ageMs = Number.isFinite(observedMs) ? Math.max(0, referenceMs - observedMs) : ZONE_WINDOW_MS;
  const recencyWeight = Math.max(0.2, 1 - ageMs / ZONE_WINDOW_MS);
  const base = 0.35 + 0.65 * normalizeRssi(event.rssi);
  const eventWeight = event.event_type === "enter" ? 1.15 : 1;
  return Number((recencyWeight * base * eventWeight).toFixed(6));
}

function sortRankedAggregates(input: Aggregate[]): RankedAggregate[] {
  const totalScore = input.reduce((sum, item) => sum + item.score, 0);
  const sorted = [...input].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.hit_count !== left.hit_count) return right.hit_count - left.hit_count;
    const leftMs = Date.parse(left.latest_seen_at);
    const rightMs = Date.parse(right.latest_seen_at);
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
  return sorted.map((item, index) => ({
    ...item,
    confidence: totalScore > 0 ? Number((item.score / totalScore).toFixed(6)) : 0,
    margin: Number((item.score - (sorted[index + 1]?.score ?? 0)).toFixed(6)),
  }));
}

function buildUnknownCandidate(
  lastSeenAt: string,
  floorNo: number | null,
  bestGatewayId: string | null,
  trace?: {
    reason?: string | null;
    beacon_minor?: number | null;
    hostess_id?: string | null;
  }
): CandidateZone {
  const candidate: CandidateZone = {
    floor_no: floorNo,
    zone_id: null,
    zone_code: "unknown",
    zone_type: "unknown",
    room_uuid: null,
    best_gateway_id: bestGatewayId,
    score: 0,
    confidence: 0,
    margin: 0,
    hit_count: 0,
    gateway_count: 0,
    last_seen_at: lastSeenAt,
    strongest_rssi: null,
    competing_zone_id: null,
    competing_zone_code: null,
    competing_zone_type: null,
  };
  logZoneTrace({
    step: "build_unknown_candidate",
    reason: trace?.reason ?? null,
    beacon_minor: trace?.beacon_minor ?? null,
    hostess_id: trace?.hostess_id ?? null,
    floor_no: floorNo,
    best_gateway_id: bestGatewayId,
    last_seen_at: lastSeenAt,
  });
  return candidate;
}

function sameZone(prev: CurrentZoneStateRow | null, candidate: CandidateZone): boolean {
  if (!prev) return false;
  return (
    String(prev.zone_type ?? "") === String(candidate.zone_type ?? "") &&
    String(prev.room_uuid ?? "") === String(candidate.room_uuid ?? "") &&
    String(prev.zone_id ?? "") === String(candidate.zone_id ?? "")
  );
}

function chooseCandidateZone(args: {
  events: WindowEventRow[];
  gatewayById: Map<string, GatewayZoneRow>;
  referenceMs: number;
  traceContext?: {
    beacon_minor: number;
    hostess_id: string;
  };
}): {
  candidate: CandidateZone;
  floorConfidence: number;
  bestFloorNo: number | null;
  debug: {
    joined_event_count: number;
    filtered_out_reason: string | null;
    floor_winners: Array<{
      floor_no: number | null;
      confidence: number;
      margin: number;
      hit_count: number;
    }>;
    zone_winners: Array<{
      zone_type: BleZoneType;
      zone_code: string | null;
      room_uuid: string | null;
      confidence: number;
      margin: number;
      hit_count: number;
    }>;
  };
} {
  const traceBase = {
    beacon_minor: Number.isFinite(Number(args.traceContext?.beacon_minor ?? NaN))
      ? Math.trunc(Number(args.traceContext?.beacon_minor))
      : null,
    hostess_id: isUuid(args.traceContext?.hostess_id) ? String(args.traceContext?.hostess_id).trim() : null,
  };
  const positiveEvents = args.events.filter((event) => event.event_type !== "leave");
  logZoneTrace({
    step: "choose_candidate_zone_input",
    ...traceBase,
    event_count: args.events.length,
    positive_event_count: positiveEvents.length,
    gateway_join_row_count: args.events.filter((event) => args.gatewayById.has(String(event.gateway_id ?? "").trim())).length,
    event_sample: args.events.slice(0, 5).map((event) => {
      const gateway = args.gatewayById.get(String(event.gateway_id ?? "").trim()) ?? null;
      return {
        gateway_id: event.gateway_id,
        event_type: event.event_type,
        rssi: event.rssi,
        observed_at: event.observed_at,
        gateway_floor_no: gateway?.floor_no ?? null,
        gateway_zone_id: gateway?.zone_id ?? null,
        gateway_zone_type: gateway?.zone_type ?? null,
        gateway_room_uuid: gateway?.room_uuid ?? null,
      };
    }),
  });
  if (positiveEvents.length <= 0) {
    const latestSeenAt = args.events[0]?.observed_at ?? new Date(args.referenceMs).toISOString();
    const fallbackGatewayId = normalizeOptionalText(args.events[0]?.gateway_id) ?? null;
    const candidate = buildUnknownCandidate(latestSeenAt, null, fallbackGatewayId, {
      ...traceBase,
      reason: "NO_POSITIVE_EVENTS",
    });
    logZoneTrace({
      step: "choose_candidate_zone_result",
      ...traceBase,
      final_reason: "NO_POSITIVE_EVENTS",
      joined_event_count: 0,
      candidate_summary: {
        floor_no: candidate.floor_no,
        zone_id: candidate.zone_id,
        zone_type: candidate.zone_type,
        room_uuid: candidate.room_uuid,
        confidence: candidate.confidence,
        hit_count: candidate.hit_count,
        score: candidate.score,
        strongest_rssi: candidate.strongest_rssi,
        best_gateway_id: candidate.best_gateway_id,
        gateway_count: candidate.gateway_count,
      },
    });
    return {
      candidate,
      floorConfidence: 0,
      bestFloorNo: null,
      debug: {
        joined_event_count: 0,
        filtered_out_reason: "NO_POSITIVE_EVENTS",
        floor_winners: [],
        zone_winners: [],
      },
    };
  }

  const floorMap = new Map<string, Aggregate>();
  let joinedFloorEvents = 0;
  for (const event of positiveEvents) {
    const gateway = args.gatewayById.get(String(event.gateway_id ?? "").trim());
    if (!gateway) continue;
    joinedFloorEvents += 1;
    const floorNo =
      Number.isFinite(Number(gateway.floor_no)) && Number(gateway.floor_no) > 0
        ? Math.trunc(Number(gateway.floor_no))
        : null;
    const key = String(floorNo ?? "unknown");
    const score = eventScore(event, args.referenceMs);
    const existing =
      floorMap.get(key) ??
      ({
        floor_no: floorNo,
        zone_id: null,
        zone_code: null,
        zone_type: "unknown",
        room_uuid: null,
        gateway_ids: new Set<string>(),
        score: 0,
        hit_count: 0,
        strongest_rssi: null,
        latest_seen_at: event.observed_at,
      } satisfies Aggregate);
    existing.score += score;
    existing.hit_count += 1;
    existing.gateway_ids.add(String(event.gateway_id ?? "").trim());
    if (existing.strongest_rssi == null || Number(event.rssi ?? -999) > Number(existing.strongest_rssi ?? -999)) {
      existing.strongest_rssi = event.rssi;
    }
    if (Date.parse(event.observed_at) > Date.parse(existing.latest_seen_at)) {
      existing.latest_seen_at = event.observed_at;
    }
    floorMap.set(key, existing);
  }

  const rankedFloors = sortRankedAggregates(Array.from(floorMap.values()));
  const bestFloor = rankedFloors[0] ?? null;
  const bestFloorNo = bestFloor?.floor_no ?? null;
  const floorConfidence = Number(bestFloor?.confidence ?? 0);
  const floorWinners = rankedFloors.slice(0, 3).map((row) => ({
    floor_no: row.floor_no,
    confidence: Number(row.confidence.toFixed(6)),
    margin: Number(row.margin.toFixed(6)),
    hit_count: row.hit_count,
  }));
  const deterministicSingleFloor =
    !!bestFloor &&
    bestFloorNo != null &&
    joinedFloorEvents > 0 &&
    rankedFloors.length === 1;
  const floorStrongEnough =
    !!bestFloor &&
    ((
      bestFloor.hit_count >= MIN_FLOOR_HITS &&
      floorConfidence >= MIN_FLOOR_CONFIDENCE &&
      Number(bestFloor.margin ?? 0) >= MIN_FLOOR_MARGIN
    ) ||
      deterministicSingleFloor);

  if (!floorStrongEnough || bestFloorNo == null) {
    const latestSeenAt = positiveEvents[0]?.observed_at ?? new Date(args.referenceMs).toISOString();
    const fallbackGatewayId = normalizeOptionalText(positiveEvents[0]?.gateway_id) ?? null;
    const candidate = buildUnknownCandidate(latestSeenAt, bestFloorNo, fallbackGatewayId, {
      ...traceBase,
      reason: "FLOOR_NOT_CONFIDENT",
    });
    logZoneTrace({
      step: "choose_candidate_zone_result",
      ...traceBase,
      final_reason: "FLOOR_NOT_CONFIDENT",
      joined_event_count: joinedFloorEvents,
      floor_winners: floorWinners,
      candidate_summary: {
        floor_no: candidate.floor_no,
        zone_id: candidate.zone_id,
        zone_type: candidate.zone_type,
        room_uuid: candidate.room_uuid,
        confidence: candidate.confidence,
        hit_count: candidate.hit_count,
        score: candidate.score,
        strongest_rssi: candidate.strongest_rssi,
        best_gateway_id: candidate.best_gateway_id,
        gateway_count: candidate.gateway_count,
      },
    });
    return {
      candidate,
      floorConfidence,
      bestFloorNo,
      debug: {
        joined_event_count: joinedFloorEvents,
        filtered_out_reason: "FLOOR_NOT_CONFIDENT",
        floor_winners: floorWinners,
        zone_winners: [],
      },
    };
  }

  const zoneMap = new Map<string, Aggregate>();
  let joinedZoneEvents = 0;
  for (const event of positiveEvents) {
    const gateway = args.gatewayById.get(String(event.gateway_id ?? "").trim());
    if (!gateway) continue;
    const floorNo =
      Number.isFinite(Number(gateway.floor_no)) && Number(gateway.floor_no) > 0
        ? Math.trunc(Number(gateway.floor_no))
        : null;
    if (floorNo !== bestFloorNo) continue;
    joinedZoneEvents += 1;
    const roomUuid = isUuid(gateway.room_uuid) ? String(gateway.room_uuid).trim() : null;
    const zoneType = normalizeZoneType(gateway.zone_type, roomUuid);
    const zoneCode = normalizeOptionalText(gateway.zone_code) ?? (zoneType === "room" && roomUuid ? `room:${roomUuid}` : `gateway:${gateway.gateway_id}`);
    const key = `${zoneType}:${zoneCode}`;
    const score = eventScore(event, args.referenceMs);
    const existing =
      zoneMap.get(key) ??
      ({
        floor_no: floorNo,
        zone_id: isUuid(gateway.zone_id) ? String(gateway.zone_id).trim() : null,
        zone_code: zoneCode,
        zone_type: zoneType,
        room_uuid: zoneType === "room" ? roomUuid : null,
        gateway_ids: new Set<string>(),
        score: 0,
        hit_count: 0,
        strongest_rssi: null,
        latest_seen_at: event.observed_at,
      } satisfies Aggregate);
    existing.score += score;
    existing.hit_count += 1;
    existing.gateway_ids.add(String(event.gateway_id ?? "").trim());
    if (existing.strongest_rssi == null || Number(event.rssi ?? -999) > Number(existing.strongest_rssi ?? -999)) {
      existing.strongest_rssi = event.rssi;
    }
    if (Date.parse(event.observed_at) > Date.parse(existing.latest_seen_at)) {
      existing.latest_seen_at = event.observed_at;
    }
    zoneMap.set(key, existing);
  }

  const rankedZones = sortRankedAggregates(Array.from(zoneMap.values()));
  const bestZone = rankedZones[0] ?? null;
  const secondZone = rankedZones[1] ?? null;
  const zoneWinners = rankedZones.slice(0, 3).map((row) => ({
    zone_type: row.zone_type,
    zone_code: row.zone_code,
    room_uuid: row.room_uuid,
    confidence: Number(row.confidence.toFixed(6)),
    margin: Number(row.margin.toFixed(6)),
    hit_count: row.hit_count,
  }));
  if (!bestZone) {
    const latestSeenAt = positiveEvents[0]?.observed_at ?? new Date(args.referenceMs).toISOString();
    const fallbackGatewayId = normalizeOptionalText(positiveEvents[0]?.gateway_id) ?? null;
    const candidate = buildUnknownCandidate(latestSeenAt, bestFloorNo, fallbackGatewayId, {
      ...traceBase,
      reason: "ZONE_EMPTY",
    });
    logZoneTrace({
      step: "choose_candidate_zone_result",
      ...traceBase,
      final_reason: "ZONE_EMPTY",
      joined_event_count: joinedZoneEvents,
      floor_winners: floorWinners,
      zone_winners: zoneWinners,
      candidate_summary: {
        floor_no: candidate.floor_no,
        zone_id: candidate.zone_id,
        zone_type: candidate.zone_type,
        room_uuid: candidate.room_uuid,
        confidence: candidate.confidence,
        hit_count: candidate.hit_count,
        score: candidate.score,
        strongest_rssi: candidate.strongest_rssi,
        best_gateway_id: candidate.best_gateway_id,
        gateway_count: candidate.gateway_count,
      },
    });
    return {
      candidate,
      floorConfidence,
      bestFloorNo,
      debug: {
        joined_event_count: joinedZoneEvents,
        filtered_out_reason: "ZONE_EMPTY",
        floor_winners: floorWinners,
        zone_winners: zoneWinners,
      },
    };
  }

  const minHits = bestZone.zone_type === "room" ? MIN_ROOM_HITS : MIN_NON_ROOM_HITS;
  const minConfidence = bestZone.zone_type === "room" ? MIN_ROOM_CONFIDENCE : MIN_NON_ROOM_CONFIDENCE;
  const minMargin = bestZone.zone_type === "room" ? MIN_ROOM_MARGIN : MIN_NON_ROOM_MARGIN;
  const deterministicSingleRoomZone =
    bestZone.zone_type === "room" &&
    isUuid(bestZone.room_uuid) &&
    joinedZoneEvents > 0 &&
    rankedZones.length === 1;
  const strongEnough =
    (
      bestZone.hit_count >= minHits &&
      bestZone.confidence >= minConfidence &&
      bestZone.margin >= minMargin
    ) ||
    deterministicSingleRoomZone;
  const bestGatewayId = Array.from(bestZone.gateway_ids.values())[0] ?? null;

  if (!strongEnough) {
    const candidate = buildUnknownCandidate(bestZone.latest_seen_at, bestFloorNo, bestGatewayId, {
      ...traceBase,
      reason: "ZONE_NOT_CONFIDENT",
    });
    logZoneTrace({
      step: "choose_candidate_zone_result",
      ...traceBase,
      final_reason: "ZONE_NOT_CONFIDENT",
      joined_event_count: joinedZoneEvents,
      floor_winners: floorWinners,
      zone_winners: zoneWinners,
      threshold: {
        min_hits: minHits,
        min_confidence: minConfidence,
        min_margin: minMargin,
        deterministic_single_room_zone: deterministicSingleRoomZone,
      },
      best_zone: {
        floor_no: bestZone.floor_no,
        zone_id: bestZone.zone_id,
        zone_code: bestZone.zone_code,
        zone_type: bestZone.zone_type,
        room_uuid: bestZone.room_uuid,
        confidence: Number(bestZone.confidence.toFixed(6)),
        margin: Number(bestZone.margin.toFixed(6)),
        hit_count: bestZone.hit_count,
        score: Number(bestZone.score.toFixed(6)),
        strongest_rssi: bestZone.strongest_rssi,
        best_gateway_id: bestGatewayId,
        gateway_count: bestZone.gateway_ids.size,
      },
      candidate_summary: {
        floor_no: candidate.floor_no,
        zone_id: candidate.zone_id,
        zone_type: candidate.zone_type,
        room_uuid: candidate.room_uuid,
        confidence: candidate.confidence,
        hit_count: candidate.hit_count,
        score: candidate.score,
        strongest_rssi: candidate.strongest_rssi,
        best_gateway_id: candidate.best_gateway_id,
        gateway_count: candidate.gateway_count,
      },
    });
    return {
      candidate,
      floorConfidence,
      bestFloorNo,
      debug: {
        joined_event_count: joinedZoneEvents,
        filtered_out_reason: "ZONE_NOT_CONFIDENT",
        floor_winners: floorWinners,
        zone_winners: zoneWinners,
      },
    };
  }

  const candidate = {
      floor_no: bestZone.floor_no,
      zone_id: bestZone.zone_id,
      zone_code: bestZone.zone_code,
      zone_type: bestZone.zone_type,
      room_uuid: bestZone.zone_type === "room" ? bestZone.room_uuid : null,
      best_gateway_id: bestGatewayId,
      score: Number(bestZone.score.toFixed(6)),
      confidence: Number(bestZone.confidence.toFixed(6)),
      margin: Number(bestZone.margin.toFixed(6)),
      hit_count: bestZone.hit_count,
      gateway_count: bestZone.gateway_ids.size,
      last_seen_at: bestZone.latest_seen_at,
      strongest_rssi: bestZone.strongest_rssi,
      competing_zone_id: secondZone?.zone_id ?? null,
      competing_zone_code: secondZone?.zone_code ?? null,
      competing_zone_type: secondZone?.zone_type ?? null,
    };
  logZoneTrace({
    step: "choose_candidate_zone_result",
    ...traceBase,
    final_reason: "ROOM_OR_ZONE_CONFIRMED",
    joined_event_count: joinedZoneEvents,
    floor_winners: floorWinners,
    zone_winners: zoneWinners,
    threshold: {
      min_hits: minHits,
      min_confidence: minConfidence,
      min_margin: minMargin,
      deterministic_single_room_zone: deterministicSingleRoomZone,
    },
    candidate_summary: {
      floor_no: candidate.floor_no,
      zone_id: candidate.zone_id,
      zone_type: candidate.zone_type,
      room_uuid: candidate.room_uuid,
      confidence: candidate.confidence,
      hit_count: candidate.hit_count,
      score: candidate.score,
      strongest_rssi: candidate.strongest_rssi,
      best_gateway_id: candidate.best_gateway_id,
      gateway_count: candidate.gateway_count,
    },
  });
  return {
    candidate,
    floorConfidence,
    bestFloorNo,
    debug: {
      joined_event_count: joinedZoneEvents,
      filtered_out_reason: null,
      floor_winners: floorWinners,
      zone_winners: zoneWinners,
    },
  };
}

function buildDecision(args: {
  prev: CurrentZoneStateRow | null;
  hostessId: string;
  beaconMinor: number;
  candidate: CandidateZone;
  floorConfidence: number;
  windowStartedAt: string;
  windowEndedAt: string;
}): TagDecision {
  const prevRow = args.prev;
  const nowIso = args.windowEndedAt;
  const hasConfidentCandidate = args.candidate.zone_type !== "unknown";
  const prevLastSeenMs = prevRow ? Date.parse(String(prevRow.last_seen_at ?? "")) : 0;
  const nextZone = hasConfidentCandidate
    ? args.candidate
    : prevRow && Number.isFinite(prevLastSeenMs) && Date.parse(args.windowEndedAt) - prevLastSeenMs <= EXIT_GRACE_MS
      ? {
          ...buildUnknownCandidate(args.windowEndedAt, prevRow.floor_no, null),
          floor_no: prevRow.floor_no,
          zone_id: prevRow.zone_id,
          zone_code: null,
          zone_type: prevRow.zone_type,
          room_uuid: prevRow.room_uuid,
          best_gateway_id: null,
          confidence: 0,
          margin: 0,
          hit_count: 0,
          gateway_count: 0,
          competing_zone_id: null,
          competing_zone_code: args.candidate.competing_zone_code,
          competing_zone_type: args.candidate.competing_zone_type,
        }
      : args.candidate;
  const sameAsPrev = sameZone(prevRow, nextZone);
  const nextConsecutive = hasConfidentCandidate
    ? sameAsPrev
      ? Math.max(1, Number(prevRow?.consecutive_windows ?? 0)) + 1
      : 1
    : 0;

  let nextState: BleZoneStateValue;
  if (!hasConfidentCandidate) {
    nextState = prevRow && prevRow.zone_type !== "unknown" ? "exit_pending" : "enter_pending";
  } else if (nextZone.zone_type === "room") {
    nextState = sameAsPrev && (prevRow?.state === "stay" || nextConsecutive >= ROOM_STAY_CONSECUTIVE_WINDOWS)
      ? "stay"
      : "enter_pending";
  } else {
    nextState = sameAsPrev && (prevRow?.state === "stay" || nextConsecutive >= 2)
      ? "stay"
      : "enter_pending";
  }

  const transitionChanged =
    !prevRow ||
    prevRow.state !== nextState ||
    !sameAsPrev;
  const firstEnteredAt =
    nextState === "enter_pending" && (!prevRow || !sameAsPrev)
      ? nowIso
      : nextState === "stay" && sameAsPrev
        ? prevRow?.first_entered_at ?? nowIso
        : nextState === "stay"
          ? nowIso
          : prevRow?.first_entered_at ?? null;

  return {
    hostess_id: args.hostessId,
    beacon_minor: args.beaconMinor,
    floor_no: nextZone.floor_no,
    zone_id: nextZone.zone_id,
    zone_code: nextZone.zone_code,
    zone_type: nextZone.zone_type,
    room_uuid: nextZone.zone_type === "room" ? nextZone.room_uuid : null,
    state: nextState,
    confidence: Number(nextZone.confidence.toFixed(6)),
    floor_confidence: Number(args.floorConfidence.toFixed(6)),
    zone_confidence: Number(nextZone.confidence.toFixed(6)),
    competing_zone_id: nextZone.competing_zone_id,
    competing_zone_code: nextZone.competing_zone_code,
    competing_zone_type: nextZone.competing_zone_type,
    competing_margin: nextZone.competing_zone_type ? Number(nextZone.margin.toFixed(6)) : null,
    best_gateway_id: nextZone.best_gateway_id,
    hit_count: nextZone.hit_count,
    gateway_count: nextZone.gateway_count,
    consecutive_windows: nextConsecutive,
    first_entered_at: firstEnteredAt,
    last_seen_at: nextZone.last_seen_at,
    last_transition_at: transitionChanged ? nowIso : (prevRow?.last_seen_at ?? nowIso),
    window_started_at: args.windowStartedAt,
    window_ended_at: args.windowEndedAt,
    meta: {
      inference_source: "zone_current_v1",
      strongest_rssi: nextZone.strongest_rssi,
      score: nextZone.score,
      room_confirmed: nextZone.zone_type === "room" && nextState === "stay",
      best_gateway_id: nextZone.best_gateway_id,
      zone_code: nextZone.zone_code,
      competing_zone_code: nextZone.competing_zone_code,
      competing_zone_type: nextZone.competing_zone_type,
      gateway_count: nextZone.gateway_count,
      floor_confidence: Number(args.floorConfidence.toFixed(6)),
      zone_confidence: Number(nextZone.confidence.toFixed(6)),
      competing_margin: nextZone.competing_zone_type ? Number(nextZone.margin.toFixed(6)) : null,
    },
  };
}

async function syncRoomPresenceProjection(args: {
  supabase: SupabaseClient;
  storeUuid: string;
  decision: TagDecision;
  activePresence: ActivePresenceRow | null;
  roomInfoByUuid: Map<string, RoomInfoRow>;
}): Promise<number> {
  const nowIso = args.decision.last_seen_at || new Date().toISOString();
  const active = args.activePresence;
  const roomUuid = isUuid(args.decision.room_uuid) ? String(args.decision.room_uuid).trim() : null;
  const roomInfo = roomUuid ? args.roomInfoByUuid.get(roomUuid) ?? null : null;
  const meta = {
    inference_source: "zone_current_v1",
    zone_type: args.decision.zone_type,
    zone_code: args.decision.zone_code,
    confidence: args.decision.confidence,
    floor_confidence: args.decision.floor_confidence,
    zone_confidence: args.decision.zone_confidence,
    competing_zone_type: args.decision.competing_zone_type,
    room_name: normalizeOptionalText(roomInfo?.name),
    room_no:
      Number.isFinite(Number(roomInfo?.room_no ?? NaN)) && Number(roomInfo?.room_no) > 0
        ? Math.trunc(Number(roomInfo?.room_no))
        : null,
  };
  const roomConfirmed =
    args.decision.zone_type === "room" &&
    args.decision.state === "stay" &&
    roomUuid &&
    Date.now() - Date.parse(nowIso) <= ACTIVE_ROOM_FRESH_MS;

  if (roomConfirmed) {
    if (active && String(active.room_uuid ?? "").trim() === roomUuid && String(active.gateway_id ?? "").trim() === String(args.decision.best_gateway_id ?? "").trim()) {
      const { error } = await args.supabase
        .from("hostess_presence")
        .update({
          beacon_minor: args.decision.beacon_minor,
          gateway_id: args.decision.best_gateway_id,
          store_uuid: args.storeUuid,
          room_uuid: roomUuid,
          presence_status: "present",
          last_seen_at: nowIso,
          updated_at: new Date().toISOString(),
          meta,
        })
        .eq("id", active.id);
      return error ? 0 : 1;
    }

    if (active) {
      await args.supabase
        .from("hostess_presence")
        .update({
          left_at: nowIso,
          last_seen_at: nowIso,
          presence_status: "left",
          updated_at: new Date().toISOString(),
        })
        .eq("id", active.id);
    }

    const { error: insertErr } = await args.supabase.from("hostess_presence").insert({
      hostess_id: args.decision.hostess_id,
      beacon_minor: args.decision.beacon_minor,
      gateway_id: args.decision.best_gateway_id,
      store_uuid: args.storeUuid,
      room_uuid: roomUuid,
      presence_status: "present",
      entered_at: nowIso,
      last_seen_at: nowIso,
      left_at: null,
      meta,
    });
    return insertErr ? 0 : active ? 2 : 1;
  }

  if (!active) return 0;
  const { error: closeErr } = await args.supabase
    .from("hostess_presence")
    .update({
      left_at: nowIso,
      last_seen_at: nowIso,
      presence_status: "left",
      updated_at: new Date().toISOString(),
      meta: {
        inference_source: "zone_current_v1",
        zone_type: args.decision.zone_type,
        zone_code: args.decision.zone_code,
        confidence: args.decision.confidence,
      },
    })
    .eq("id", active.id);
  return closeErr ? 0 : 1;
}

export async function applyZoneInference(args: ApplyZoneInferenceArgs): Promise<ApplyZoneInferenceResult> {
  const warnings: string[] = [];
  const storeUuid = String(args.storeUuid ?? "").trim();
  const inputBeaconMinors = Array.from(
    new Set(
      (Array.isArray(args.events) ? args.events : [])
        .map((event) => Math.trunc(Number(event?.beacon_minor ?? NaN)))
        .filter((minor) => Number.isFinite(minor) && minor > 0)
    )
  );
  logZoneTrace({
    step: "enter_apply_zone_inference",
    store_uuid: storeUuid || null,
    beacon_minor_list: inputBeaconMinors,
    event_count: Array.isArray(args.events) ? args.events.length : 0,
  });
  if (!isUuid(storeUuid)) {
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: ["ZONE_INFERENCE_STORE_SCOPE_MISSING"],
      fallback_to_legacy: true,
      schema_detected: true,
      fallback_reason: "ZONE_INFERENCE_STORE_SCOPE_MISSING",
      affected_hostess_ids: [],
      beacon_minors: inputBeaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }

  const beaconMinors = inputBeaconMinors;
  if (beaconMinors.length <= 0) {
    return {
      ok: true,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings,
      fallback_to_legacy: false,
      schema_detected: true,
      fallback_reason: null,
      affected_hostess_ids: [],
      beacon_minors: beaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }

  const latestObservedMs = Math.max(
    ...args.events.map((event) => {
      const ms = Date.parse(String(event?.observed_at ?? ""));
      return Number.isFinite(ms) ? ms : 0;
    }),
    Date.now()
  );
  const windowEndedAt = new Date(latestObservedMs).toISOString();
  const windowStartedAt = new Date(latestObservedMs - ZONE_WINDOW_MS).toISOString();

  const tagRows: TagRow[] =
    Array.isArray(args.preloadedTags) && args.preloadedTags.length > 0
      ? args.preloadedTags
      : (() => {
          return [];
        })();
  let resolvedTagRows = tagRows;
  if (resolvedTagRows.length <= 0) {
    const tagResult = await args.supabase
      .from("ble_tags")
      .select("beacon_minor, hostess_id, is_active")
      .in("beacon_minor", beaconMinors);
    if (tagResult.error) {
      return {
        ok: false,
        zone_state_updates: 0,
        room_presence_updates: 0,
        warnings: [`ZONE_INFERENCE_TAG_LOOKUP_FAIL:${String(tagResult.error.message ?? tagResult.error)}`],
        fallback_to_legacy: true,
        schema_detected: true,
        fallback_reason: `ZONE_INFERENCE_TAG_LOOKUP_FAIL:${String(tagResult.error.message ?? tagResult.error)}`,
        affected_hostess_ids: [],
        beacon_minors: beaconMinors,
        gateway_zone_join_count: 0,
        candidate_count: 0,
      };
    }
    resolvedTagRows = Array.isArray(tagResult.data) ? (tagResult.data as TagRow[]) : [];
  }

  const tagByMinor = new Map<number, TagRow>();
  for (const row of resolvedTagRows) {
    const minor = Math.trunc(Number((row as any)?.beacon_minor ?? NaN));
    if (!Number.isFinite(minor) || minor <= 0) continue;
    tagByMinor.set(minor, row);
  }

  const eventsResult = await args.supabase
    .from("ble_ingest_events")
    .select("gateway_id, beacon_minor, event_type, rssi, observed_at")
    .eq("store_uuid", storeUuid)
    .in("beacon_minor", beaconMinors)
    .gte("observed_at", windowStartedAt)
    .lte("observed_at", windowEndedAt)
    .order("observed_at", { ascending: false });
  if (eventsResult.error) {
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: [`ZONE_INFERENCE_WINDOW_QUERY_FAIL:${String(eventsResult.error.message ?? eventsResult.error)}`],
      fallback_to_legacy: true,
      schema_detected: true,
      fallback_reason: `ZONE_INFERENCE_WINDOW_QUERY_FAIL:${String(eventsResult.error.message ?? eventsResult.error)}`,
      affected_hostess_ids: [],
      beacon_minors: beaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }
  const windowEvents = Array.isArray(eventsResult.data) ? (eventsResult.data as WindowEventRow[]) : [];
  const gatewayIds = Array.from(new Set(windowEvents.map((event) => String(event.gateway_id ?? "").trim()).filter(Boolean)));
  logZoneTrace({
    step: "load_recent_events",
    store_uuid: storeUuid,
    beacon_minor_list: beaconMinors,
    recent_event_count: windowEvents.length,
    gateway_id_count: gatewayIds.length,
    beacon_event_counts: beaconMinors.map((minor) => ({
      beacon_minor: minor,
      recent_event_count: windowEvents.filter((event) => Math.trunc(Number(event.beacon_minor ?? NaN)) === minor).length,
    })),
    recent_event_sample: windowEvents.slice(0, 5).map((event) => ({
      gateway_id: event.gateway_id,
      beacon_minor: event.beacon_minor,
      event_type: event.event_type,
      rssi: event.rssi,
      observed_at: event.observed_at,
    })),
    window_started_at: windowStartedAt,
    window_ended_at: windowEndedAt,
  });
  if (gatewayIds.length <= 0) {
    return {
      ok: true,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings,
      fallback_to_legacy: false,
      schema_detected: true,
      fallback_reason: null,
      affected_hostess_ids: [],
      beacon_minors: beaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }

  const gatewayResult = await args.supabase
    .from("ble_gateways")
    .select("id, gateway_id, store_uuid, room_uuid, floor_no, zone_id")
    .eq("store_uuid", storeUuid)
    .in("gateway_id", gatewayIds);
  if (gatewayResult.error) {
    const fallback =
      isMissingColumn(gatewayResult.error, ["zone_id", "floor_no"]) ||
      isMissingTableOrSchemaCache(gatewayResult.error, ["public.ble_gateways", "ble_gateways"]);
    logZoneTrace({
      step: "join_gateway_zone_meta",
      store_uuid: storeUuid,
      gateway_id_count: gatewayIds.length,
      gateway_query_row_count: 0,
      zone_query_row_count: 0,
      gateway_zone_join_success_count: 0,
      zone_schema_detected: !fallback,
      fallback_reason: `ZONE_INFERENCE_GATEWAY_META_FAIL:${String(gatewayResult.error.message ?? gatewayResult.error)}`,
    });
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: [`ZONE_INFERENCE_GATEWAY_META_FAIL:${String(gatewayResult.error.message ?? gatewayResult.error)}`],
      fallback_to_legacy: fallback,
      schema_detected: !fallback,
      fallback_reason: `ZONE_INFERENCE_GATEWAY_META_FAIL:${String(gatewayResult.error.message ?? gatewayResult.error)}`,
      affected_hostess_ids: [],
      beacon_minors: beaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }
  const gatewayBaseRows = Array.isArray(gatewayResult.data) ? (gatewayResult.data as GatewayBaseRow[]) : [];
  const zoneIds = Array.from(
    new Set(
      gatewayBaseRows
        .map((row) => String((row as any)?.zone_id ?? "").trim())
        .filter((value) => isUuid(value))
    )
  );
  const zoneResult =
    zoneIds.length > 0
      ? await args.supabase
          .from("ble_zones")
          .select("id, store_uuid, floor_no, zone_type, zone_code, room_uuid, is_active")
          .in("id", zoneIds)
      : ({ data: [], error: null } as { data: ZoneRow[]; error: null });
  if (zoneResult.error) {
    const fallback =
      isMissingColumn(zoneResult.error, ["zone_code", "zone_type", "floor_no"]) ||
      isMissingTableOrSchemaCache(zoneResult.error, ["public.ble_zones", "ble_zones"]);
    logZoneTrace({
      step: "join_gateway_zone_meta",
      store_uuid: storeUuid,
      gateway_id_count: gatewayIds.length,
      gateway_query_row_count: gatewayBaseRows.length,
      zone_query_row_count: 0,
      gateway_zone_join_success_count: 0,
      zone_schema_detected: !fallback,
      gateway_row_sample: gatewayBaseRows.slice(0, 3),
      fallback_reason: `ZONE_INFERENCE_ZONE_META_FAIL:${String(zoneResult.error.message ?? zoneResult.error)}`,
    });
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: [`ZONE_INFERENCE_ZONE_META_FAIL:${String(zoneResult.error.message ?? zoneResult.error)}`],
      fallback_to_legacy: fallback,
      schema_detected: !fallback,
      fallback_reason: `ZONE_INFERENCE_ZONE_META_FAIL:${String(zoneResult.error.message ?? zoneResult.error)}`,
      affected_hostess_ids: [],
      beacon_minors: beaconMinors,
      gateway_zone_join_count: 0,
      candidate_count: 0,
    };
  }
  const zoneById = new Map<string, ZoneRow>();
  for (const row of Array.isArray(zoneResult.data) ? (zoneResult.data as ZoneRow[]) : []) {
    const zoneId = String((row as any)?.id ?? "").trim();
    if (!isUuid(zoneId)) continue;
    zoneById.set(zoneId, row);
  }
  const gatewayById = new Map<string, GatewayZoneRow>();
  let gatewayZoneJoinSuccessCount = 0;
  const joinFailedGateways: Array<{ gateway_id: string; zone_id: string | null; room_uuid: string | null }> = [];
  for (const row of gatewayBaseRows) {
    const gatewayId = String((row as any)?.gateway_id ?? "").trim();
    if (!gatewayId) continue;
    const zoneId = isUuid(row.zone_id) ? String(row.zone_id).trim() : null;
    const zone = zoneId ? zoneById.get(zoneId) ?? null : null;
    if (zone) gatewayZoneJoinSuccessCount += 1;
    if (!zone) {
      joinFailedGateways.push({
        gateway_id: gatewayId,
        zone_id: zoneId,
        room_uuid: isUuid(row.room_uuid) ? String(row.room_uuid).trim() : null,
      });
    }
    gatewayById.set(gatewayId, {
      id: row.id,
      gateway_id: gatewayId,
      store_uuid: row.store_uuid,
      room_uuid:
        (zone && isUuid(zone.room_uuid) ? String(zone.room_uuid).trim() : null) ??
        (isUuid(row.room_uuid) ? String(row.room_uuid).trim() : null),
      floor_no:
        Number.isFinite(Number(zone?.floor_no ?? NaN)) && Number(zone?.floor_no) > 0
          ? Math.trunc(Number(zone?.floor_no))
          : Number.isFinite(Number(row.floor_no ?? NaN)) && Number(row.floor_no) > 0
            ? Math.trunc(Number(row.floor_no))
            : null,
      zone_id: zoneId,
      zone_type: normalizeOptionalText(zone?.zone_type) ?? (isUuid(row.room_uuid) ? "room" : "unknown"),
      zone_code: normalizeOptionalText(zone?.zone_code) ?? null,
    });
  }
  logZoneTrace({
    step: "join_gateway_zone_meta",
    store_uuid: storeUuid,
    gateway_id_count: gatewayIds.length,
    gateway_query_row_count: gatewayBaseRows.length,
    zone_query_row_count: zoneById.size,
    gateway_zone_join_success_count: gatewayZoneJoinSuccessCount,
    zone_schema_detected: true,
    gateway_row_sample: gatewayBaseRows.slice(0, 3),
    zone_row_sample: Array.from(zoneById.values()).slice(0, 3),
    mapped_gateway_sample: Array.from(gatewayById.values()).slice(0, 3),
    join_failed_gateway_sample: joinFailedGateways.slice(0, 3),
  });

  const hostessIds = Array.from(
    new Set(
      beaconMinors
        .map((minor) => {
          const row = tagByMinor.get(minor);
          if (!row || row.is_active === false) return null;
          return isUuid(row.hostess_id) ? String(row.hostess_id).trim() : null;
        })
        .filter((value): value is string => isUuid(value))
    )
  );
  const unresolvedMinors = beaconMinors.filter((minor) => {
    const row = tagByMinor.get(minor);
    return !(row && row.is_active !== false && isUuid(row.hostess_id));
  });
  logZoneTrace({
    step: "resolved_tag_subjects",
    store_uuid: storeUuid,
    beacon_minor_list: beaconMinors,
    affected_hostess_count: hostessIds.length,
    affected_hostess_ids: hostessIds,
    filtered_out_reason: unresolvedMinors.length > 0 ? "HOSTESS_NOT_MAPPED_OR_INACTIVE" : null,
    filtered_out_beacon_minors: unresolvedMinors,
  });
  if (hostessIds.length <= 0) {
    return {
      ok: true,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings,
      fallback_to_legacy: false,
      schema_detected: true,
      fallback_reason: null,
      affected_hostess_ids: hostessIds,
      beacon_minors: beaconMinors,
      gateway_zone_join_count: gatewayZoneJoinSuccessCount,
      candidate_count: 0,
    };
  }

  const currentStateResult = await args.supabase
    .from("ble_tag_zone_state_current")
    .select(CURRENT_STATE_SELECT_COLUMNS.join(", "))
    .eq("store_uuid", storeUuid)
    .in("hostess_id", hostessIds);
  if (currentStateResult.error) {
    const fallback =
      isMissingTableOrSchemaCache(currentStateResult.error, ["public.ble_tag_zone_state_current", "ble_tag_zone_state_current"]) ||
      isMissingColumn(currentStateResult.error, ["zone_type", "consecutive_windows"]);
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: [`ZONE_INFERENCE_CURRENT_STATE_FAIL:${String(currentStateResult.error.message ?? currentStateResult.error)}`],
      fallback_to_legacy: fallback,
      schema_detected: !fallback,
      fallback_reason: `ZONE_INFERENCE_CURRENT_STATE_FAIL:${String(currentStateResult.error.message ?? currentStateResult.error)}`,
      affected_hostess_ids: hostessIds,
      beacon_minors: beaconMinors,
      gateway_zone_join_count: gatewayZoneJoinSuccessCount,
      candidate_count: 0,
    };
  }
  const currentStateByHostessId = new Map<string, CurrentZoneStateRow>();
  for (const row of Array.isArray(currentStateResult.data) ? (currentStateResult.data as unknown as CurrentZoneStateRow[]) : []) {
    const hostessId = String((row as any)?.hostess_id ?? "").trim();
    if (!isUuid(hostessId)) continue;
    currentStateByHostessId.set(hostessId, row);
  }

  const activePresenceResult = await args.supabase
    .from("hostess_presence")
    .select("id, hostess_id, room_uuid, gateway_id")
    .eq("store_uuid", storeUuid)
    .is("left_at", null)
    .in("hostess_id", hostessIds);
  const activePresenceByHostessId = new Map<string, ActivePresenceRow>();
  if (!activePresenceResult.error) {
    for (const row of Array.isArray(activePresenceResult.data) ? (activePresenceResult.data as ActivePresenceRow[]) : []) {
      const hostessId = String((row as any)?.hostess_id ?? "").trim();
      if (!isUuid(hostessId) || activePresenceByHostessId.has(hostessId)) continue;
      activePresenceByHostessId.set(hostessId, row);
    }
  }

  const decisions: TagDecision[] = [];
  const floorTraceRows: Array<Record<string, unknown>> = [];
  const zoneTraceRows: Array<Record<string, unknown>> = [];
  const finalCandidateRows: Array<Record<string, unknown>> = [];
  for (const minor of beaconMinors) {
    const tag = tagByMinor.get(minor) ?? null;
    const hostessId = tag && tag.is_active !== false && isUuid(tag.hostess_id) ? String(tag.hostess_id).trim() : null;
    if (!hostessId) {
      warnings.push(`ZONE_INFERENCE_SKIP:${minor}:HOSTESS_NOT_MAPPED`);
      continue;
    }
    const tagEvents = windowEvents.filter((event) => Math.trunc(Number(event.beacon_minor ?? NaN)) === minor);
    if (tagEvents.length <= 0) {
      warnings.push(`ZONE_INFERENCE_SKIP:${minor}:WINDOW_EMPTY`);
      continue;
    }
    const { candidate, floorConfidence, debug } = chooseCandidateZone({
      events: tagEvents,
      gatewayById,
      referenceMs: latestObservedMs,
      traceContext: {
        beacon_minor: minor,
        hostess_id: hostessId,
      },
    });
    floorTraceRows.push({
      beacon_minor: minor,
      hostess_id: hostessId,
      floor_winners: debug.floor_winners,
      filtered_out_reason: debug.filtered_out_reason,
      joined_event_count: debug.joined_event_count,
    });
    zoneTraceRows.push({
      beacon_minor: minor,
      hostess_id: hostessId,
      zone_winners: debug.zone_winners,
      filtered_out_reason: debug.filtered_out_reason,
      joined_event_count: debug.joined_event_count,
    });
    const decision = buildDecision({
      prev: currentStateByHostessId.get(hostessId) ?? null,
      hostessId,
      beaconMinor: minor,
      candidate,
      floorConfidence,
      windowStartedAt,
      windowEndedAt,
    });
    finalCandidateRows.push({
      beacon_minor: minor,
      hostess_id: hostessId,
      floor_no: decision.floor_no,
      zone_id: decision.zone_id,
      zone_type: decision.zone_type,
      room_uuid: decision.room_uuid,
      state: decision.state,
      confidence: decision.confidence,
      margin: decision.competing_margin,
      hit_count: decision.hit_count,
      consecutive_windows: decision.consecutive_windows,
      best_gateway_id: decision.best_gateway_id,
      gateway_count: decision.gateway_count,
      score: Number((decision.meta?.score as number | null | undefined) ?? 0),
      strongest_rssi: (decision.meta?.strongest_rssi as number | null | undefined) ?? null,
      filtered_out_reason: debug.filtered_out_reason,
    });
    decisions.push(decision);
  }
  logZoneTrace({
    step: "score_floors",
    store_uuid: storeUuid,
    affected_hostess_count: hostessIds.length,
    floor_winners: floorTraceRows,
  });
  logZoneTrace({
    step: "score_zones",
    store_uuid: storeUuid,
    affected_hostess_count: hostessIds.length,
    zone_winners: zoneTraceRows,
  });
  logZoneTrace({
    step: "final_candidates",
    store_uuid: storeUuid,
    affected_hostess_count: hostessIds.length,
    final_candidates: finalCandidateRows,
  });

  if (decisions.length <= 0) {
    return {
      ok: true,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings,
      fallback_to_legacy: false,
      schema_detected: true,
      fallback_reason: null,
      affected_hostess_ids: hostessIds,
      beacon_minors: beaconMinors,
      gateway_zone_join_count: gatewayZoneJoinSuccessCount,
      candidate_count: 0,
    };
  }

  const roomUuids = Array.from(
    new Set(
      decisions
        .map((decision) => (decision.zone_type === "room" && isUuid(decision.room_uuid) ? String(decision.room_uuid).trim() : null))
        .filter((value): value is string => isUuid(value))
    )
  );
  const roomInfoByUuid = new Map<string, RoomInfoRow>();
  if (roomUuids.length > 0) {
    const roomResult = await args.supabase
      .from("rooms")
      .select("id, room_no, name")
      .in("id", roomUuids);
    if (!roomResult.error) {
      for (const row of Array.isArray(roomResult.data) ? (roomResult.data as RoomInfoRow[]) : []) {
        const roomUuid = String((row as any)?.id ?? "").trim();
        if (!isUuid(roomUuid)) continue;
        roomInfoByUuid.set(roomUuid, row);
      }
    }
  }

  const zoneStateUpsertRows = buildCurrentStateUpsertRows(storeUuid, decisions);
  logZoneTrace({
    step: "before_upsert_current_state",
    store_uuid: storeUuid,
    affected_hostess_count: hostessIds.length,
    upsert_count: zoneStateUpsertRows.length,
    zone_types: zoneStateUpsertRows.map((row) => row.zone_type),
    upsert_columns: CURRENT_STATE_UPSERT_COLUMNS,
    decision_payloads: zoneStateUpsertRows.map((row) => ({
      hostess_id: row.hostess_id,
      beacon_minor: row.beacon_minor,
      floor_no: row.floor_no,
      zone_id: row.zone_id,
      zone_type: row.zone_type,
      room_uuid: row.room_uuid,
      confidence: row.confidence,
      hit_count: row.hit_count,
      score: Number(((row.meta as Record<string, unknown> | null)?.score as number | null | undefined) ?? 0),
      strongest_rssi: ((row.meta as Record<string, unknown> | null)?.strongest_rssi as number | null | undefined) ?? null,
    })),
  });
  const upsertResult = await args.supabase
    .from("ble_tag_zone_state_current")
    .upsert(zoneStateUpsertRows, { onConflict: "store_uuid,hostess_id" });
  if (upsertResult.error) {
    return {
      ok: false,
      zone_state_updates: 0,
      room_presence_updates: 0,
      warnings: [`ZONE_INFERENCE_UPSERT_FAIL:${String(upsertResult.error.message ?? upsertResult.error)}`],
      fallback_to_legacy: true,
      schema_detected: true,
      fallback_reason: `ZONE_INFERENCE_UPSERT_FAIL:${String(upsertResult.error.message ?? upsertResult.error)}`,
      affected_hostess_ids: hostessIds,
      beacon_minors: beaconMinors,
      gateway_zone_join_count: gatewayZoneJoinSuccessCount,
      candidate_count: decisions.length,
    };
  }
  logZoneTrace({
    step: "after_upsert_current_state",
    store_uuid: storeUuid,
    affected_hostess_count: hostessIds.length,
    upsert_count: zoneStateUpsertRows.length,
  });

  let roomPresenceUpdates = 0;
  for (const decision of decisions) {
    roomPresenceUpdates += await syncRoomPresenceProjection({
      supabase: args.supabase,
      storeUuid,
      decision,
      activePresence: activePresenceByHostessId.get(decision.hostess_id) ?? null,
      roomInfoByUuid,
    });
  }

  return {
    ok: true,
    zone_state_updates: decisions.length,
    room_presence_updates: roomPresenceUpdates,
    warnings: Array.from(new Set(warnings)),
    fallback_to_legacy: false,
    schema_detected: true,
    fallback_reason: null,
    affected_hostess_ids: hostessIds,
    beacon_minors: beaconMinors,
    gateway_zone_join_count: gatewayZoneJoinSuccessCount,
    candidate_count: decisions.length,
  };
}
