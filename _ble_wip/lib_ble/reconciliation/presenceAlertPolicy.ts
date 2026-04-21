import type { PresenceStatus, ReconciledParticipant, ReconciledRoom } from "@/lib/ble/reconciliation/resolveRoomPresence";

export const MISSING_ALERT_MS = 30_000;

export type RoomAnomalyLevel = "normal" | "warning" | "critical";

export type ReconciledParticipantAlert = ReconciledParticipant & {
  first_detected_at?: number | null;
  alert_elapsed_ms?: number;
};

export type RoomPresenceAlertSummary = {
  room_uuid: string;
  session_id?: string | null;
  level: RoomAnomalyLevel;
  counts: {
    present: number;
    missing: number;
    ghost: number;
  };
  participants: ReconciledParticipantAlert[];
  has_missing: boolean;
  has_ghost: boolean;
  missing_critical_count: number;
};

export function buildPresenceAlertTrackingKey(args: {
  room_uuid: string;
  session_id?: string | null;
  hostess_id: string;
  status: PresenceStatus;
}): string {
  const roomUuid = String(args.room_uuid ?? "").trim();
  const sessionId = String(args.session_id ?? "").trim() || "no-session";
  const hostessId = String(args.hostess_id ?? "").trim();
  const status = String(args.status ?? "").trim();
  return `${roomUuid}:${sessionId}:${hostessId}:${status}`;
}

export function buildRoomPresenceAlertSummary(args: {
  reconciledRoom: ReconciledRoom;
  firstDetectedAtByKey: ReadonlyMap<string, number>;
  nowMs?: number;
}): RoomPresenceAlertSummary {
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const participants = args.reconciledRoom.participants.map((participant) => {
    if (participant.status === "present") {
      return {
        ...participant,
        first_detected_at: null,
        alert_elapsed_ms: 0,
      } satisfies ReconciledParticipantAlert;
    }

    const trackingKey = buildPresenceAlertTrackingKey({
      room_uuid: args.reconciledRoom.room_uuid,
      session_id: args.reconciledRoom.session_id ?? null,
      hostess_id: participant.hostess_id,
      status: participant.status,
    });
    const firstDetectedAt = args.firstDetectedAtByKey.get(trackingKey) ?? nowMs;
    return {
      ...participant,
      first_detected_at: firstDetectedAt,
      alert_elapsed_ms: Math.max(0, nowMs - firstDetectedAt),
    } satisfies ReconciledParticipantAlert;
  });

  const hasMissing = participants.some((participant) => participant.status === "missing");
  const hasGhost = participants.some((participant) => participant.status === "ghost");
  const missingCriticalCount = participants.filter(
    (participant) =>
      participant.status === "missing" && Number(participant.alert_elapsed_ms ?? 0) >= MISSING_ALERT_MS
  ).length;

  let level: RoomAnomalyLevel = "normal";
  if (missingCriticalCount > 0) {
    level = "critical";
  } else if (hasMissing || hasGhost) {
    level = "warning";
  }

  return {
    room_uuid: args.reconciledRoom.room_uuid,
    session_id: args.reconciledRoom.session_id ?? null,
    level,
    counts: args.reconciledRoom.counts,
    participants,
    has_missing: hasMissing,
    has_ghost: hasGhost,
    missing_critical_count: missingCriticalCount,
  };
}
