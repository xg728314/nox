// Phase C1: Segment lifecycle integration helpers
// Wire segment operations into real operating flows

import type { ParticipantTimeSegment, SegmentClosedReason } from "./segmentTypes";
import { createSegment, closeSegment, getActiveSegment } from "./segmentHelpers";

/**
 * Phase C1: Segment-participant binding registry
 * Maps temporary participant identifiers to real participant UUIDs
 * Local-first only (no persistence needed yet)
 */
const participantBindingMap = new Map<string, string>(); // temp_id -> real_participant_uuid

/**
 * Bind a temporary participant identifier to the real participant UUID
 * Call this immediately after participant creation succeeds
 */
export function bindParticipantSegment(
  tempId: string,
  realParticipantId: string
): void {
  if (!tempId || !realParticipantId) return;
  participantBindingMap.set(tempId, realParticipantId);
}

/**
 * Get the real participant ID from a temporary or real ID
 * Returns the real ID if bound, otherwise returns the input unchanged
 */
export function resolveParticipantId(idOrTempId: string): string {
  return participantBindingMap.get(idOrTempId) || idOrTempId;
}

/**
 * Check if participant has active segment in a specific room
 * Used for duplicate prevention
 */
export function hasActiveSegmentInRoom(
  segments: ParticipantTimeSegment[],
  participantId: string,
  roomUuid: string
): boolean {
  const realId = resolveParticipantId(participantId);
  
  return segments.some(seg =>
    (seg.participant_id === participantId || seg.participant_id === realId) &&
    seg.room_uuid === roomUuid &&
    seg.exited_at === null
  );
}

/**
 * Get active segment for participant (any room)
 * Returns the most recent open segment
 */
export function getParticipantActiveSegment(
  segments: ParticipantTimeSegment[],
  participantId: string
): ParticipantTimeSegment | null {
  const realId = resolveParticipantId(participantId);
  
  const activeSegments = segments.filter(seg =>
    (seg.participant_id === participantId || seg.participant_id === realId) &&
    seg.exited_at === null
  );
  
  if (activeSegments.length === 0) return null;
  
  // Return most recent if multiple (shouldn't happen, but safe)
  return activeSegments.reduce((latest, seg) =>
    new Date(seg.entered_at) > new Date(latest.entered_at) ? seg : latest
  );
}

/**
 * Phase C1: Safe segment creation with duplicate prevention
 * Call this on entry (manual or BLE auto)
 * 
 * Rules:
 * - Same room + open segment = no-op (keep existing)
 * - Different room + open segment = close old, create new
 * - No open segment = create new
 */
export function safeCreateEntrySegment(params: {
  segments: ParticipantTimeSegment[];
  participant_id: string;
  session_id: string | null;
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  source: "manual" | "auto" | "correction";
  confidence_score?: number;
}): {
  action: "created" | "kept_existing" | "moved";
  segment: ParticipantTimeSegment | null;
  closedSegment?: ParticipantTimeSegment;
} {
  const { segments, participant_id, room_uuid } = params;
  
  // Check for existing open segment
  const activeSegment = getParticipantActiveSegment(segments, participant_id);
  
  if (!activeSegment) {
    // No active segment - create new
    const segment = createSegment(params);
    return { action: "created", segment };
  }
  
  // Has active segment
  if (activeSegment.room_uuid === room_uuid) {
    // Same room - keep existing (duplicate prevention)
    return { action: "kept_existing", segment: activeSegment };
  }
  
  // Different room - close old, create new
  const closedSegment = closeSegment(activeSegment, "room_move"); // Exact reason
  const newSegment = createSegment(params);
  
  return {
    action: "moved",
    segment: newSegment,
    closedSegment,
  };
}

/**
 * Phase C1: Close segment on explicit exit
 * Call this when participant exits (manual or checkout)
 */
export function closeParticipantSegment(
  segments: ParticipantTimeSegment[],
  participantId: string,
  reason: SegmentClosedReason
): ParticipantTimeSegment | null {
  const activeSegment = getParticipantActiveSegment(segments, participantId);
  
  if (!activeSegment) return null;
  
  return closeSegment(activeSegment, reason);
}

/**
 * Phase D: Close all open segments (e.g., on checkout/session close)
 * Use this when you don't have specific participant IDs but need to close everything
 */
export function closeAllOpenSegments(
  allSegments: Map<string, ParticipantTimeSegment[]>,
  reason: SegmentClosedReason
): Map<string, ParticipantTimeSegment[]> {
  const updated = new Map<string, ParticipantTimeSegment[]>();
  
  allSegments.forEach((segments, participantId) => {
    const updatedSegments = segments.map(seg =>
      seg.exited_at === null ? closeSegment(seg, reason) : seg
    );
    updated.set(participantId, updatedSegments);
  });
  
  return updated;
}

/**
 * Phase D: Close all segments for a specific session
 */
export function closeSegmentsBySessionId(
  allSegments: Map<string, ParticipantTimeSegment[]>,
  sessionId: string | null,
  reason: SegmentClosedReason
): Map<string, ParticipantTimeSegment[]> {
  if (!sessionId) return allSegments;
  
  const updated = new Map<string, ParticipantTimeSegment[]>();
  
  allSegments.forEach((segments, participantId) => {
    const updatedSegments = segments.map(seg =>
      seg.session_id === sessionId && seg.exited_at === null
        ? closeSegment(seg, reason)
        : seg
    );
    updated.set(participantId, updatedSegments);
  });
  
  return updated;
}
