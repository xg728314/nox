// Phase C1: Manual check-in segment creation helper
// Handles segment creation for manual check-ins that don't go through BLE flow

import type { ParticipantTimeSegment } from "@/lib/ble/segmentTypes";
import { createSegment } from "@/lib/ble/segmentHelpers";

/**
 * Create segment for manual check-in
 * Call this after successful manual check-in to track entry time
 */
export function createManualCheckInSegment(params: {
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  session_id: string | null;
  hostess_name?: string | null;
  manager_name?: string | null;
}): ParticipantTimeSegment {
  // Use hostess name as stable identifier (will be replaced with real participant_id later)
  const participantId = params.hostess_name 
    ? `manual-${params.hostess_name.replace(/\s/g, '_')}`
    : `manual-${Date.now()}`;
  
  return createSegment({
    participant_id: participantId,
    session_id: params.session_id,
    room_uuid: params.room_uuid,
    room_no: params.room_no,
    room_name: params.room_name,
    source: "manual",
    confidence_score: 1.0, // Manual entry has perfect confidence
  });
}
