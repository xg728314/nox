// Phase C: Segment-based time tracking types
// Immutable time segments instead of elapsed time accumulation

export type SegmentClosedReason =
  | "exit"            // Normal exit
  | "room_move"       // Moved to different room (exact reason required)
  | "session_end"     // Session ended
  | "manual_close"    // Manually closed
  | "manual_checkout" // Checkout confirmed (exact reason required)
  | "session_close"   // Session close (exact reason required)
  | "correction";     // Corrected/adjusted

/**
 * ParticipantTimeSegment
 * 
 * Immutable record of time spent in a specific room.
 * Multiple segments can exist for same participant.
 * Total time is computed by summing all segments.
 */
export interface ParticipantTimeSegment {
  // Identity
  segment_id: string;
  participant_id: string;
  session_id: string | null;
  
  // Location
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  
  // Time (ISO timestamps)
  entered_at: string;
  exited_at: string | null;  // null = still in room
  
  // Metadata
  closed_reason: SegmentClosedReason | null;
  source: "manual" | "auto" | "correction";
  confidence_score: number | null;  // For auto-created segments
  
  // Audit
  created_at: string;
  updated_at: string;
}

/**
 * Computed time result
 */
export interface ComputedTime {
  total_seconds: number;
  total_minutes: number;
  segment_count: number;
  first_entry: string | null;
  last_exit: string | null;
  is_currently_in_room: boolean;
}
