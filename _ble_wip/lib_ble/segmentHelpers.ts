// Phase C: Segment-based time calculation helpers
// All time derived from immutable segments

import type { ParticipantTimeSegment, ComputedTime, SegmentClosedReason } from "./segmentTypes";

/**
 * Create a new time segment on entry
 */
export function createSegment(params: {
  participant_id: string;
  session_id: string | null;
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  source: "manual" | "auto" | "correction";
  confidence_score?: number;
}): ParticipantTimeSegment {
  const now = new Date().toISOString();
  
  return {
    segment_id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    participant_id: params.participant_id,
    session_id: params.session_id,
    room_uuid: params.room_uuid,
    room_no: params.room_no,
    room_name: params.room_name,
    entered_at: now,
    exited_at: null,
    closed_reason: null,
    source: params.source,
    confidence_score: params.confidence_score ?? null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Close an existing segment
 */
export function closeSegment(
  segment: ParticipantTimeSegment,
  reason: SegmentClosedReason
): ParticipantTimeSegment {
  const now = new Date().toISOString();
  
  return {
    ...segment,
    exited_at: now,
    closed_reason: reason,
    updated_at: now,
  };
}

/**
 * Merge segments with short gaps (< 2 minutes in same room)
 */
export function mergeSegments(segments: ParticipantTimeSegment[]): ParticipantTimeSegment[] {
  if (segments.length === 0) return [];
  
  // Sort by entered_at
  const sorted = [...segments].sort((a, b) => 
    new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
  );
  
  const merged: ParticipantTimeSegment[] = [];
  let current = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Can merge if:
    // - same room
    // - current has exit time
    // - gap < 2 minutes
    if (
      current.room_uuid === next.room_uuid &&
      current.exited_at &&
      next.entered_at
    ) {
      const exitTime = new Date(current.exited_at).getTime();
      const entryTime = new Date(next.entered_at).getTime();
      const gapMs = entryTime - exitTime;
      
      if (gapMs < 120_000) { // 2 minutes
        // Merge: extend current to next's exit
        current = {
          ...current,
          exited_at: next.exited_at,
          closed_reason: next.closed_reason,
          updated_at: new Date().toISOString(),
        };
        continue;
      }
    }
    
    // Cannot merge - push current and move to next
    merged.push(current);
    current = next;
  }
  
  // Push last segment
  merged.push(current);
  
  return merged;
}

/**
 * Compute total time from segments
 */
export function computeTotalTime(segments: ParticipantTimeSegment[]): ComputedTime {
  if (segments.length === 0) {
    return {
      total_seconds: 0,
      total_minutes: 0,
      segment_count: 0,
      first_entry: null,
      last_exit: null,
      is_currently_in_room: false,
    };
  }
  
  // Merge segments first
  const merged = mergeSegments(segments);
  
  let totalMs = 0;
  let firstEntry: string | null = null;
  let lastExit: string | null = null;
  let hasOpenSegment = false;
  
  merged.forEach(seg => {
    // Track first entry
    if (!firstEntry || new Date(seg.entered_at) < new Date(firstEntry)) {
      firstEntry = seg.entered_at;
    }
    
    // Track last exit
    if (seg.exited_at) {
      if (!lastExit || new Date(seg.exited_at) > new Date(lastExit)) {
        lastExit = seg.exited_at;
      }
    }
    
    // Calculate duration
    if (seg.exited_at) {
      const enteredMs = new Date(seg.entered_at).getTime();
      const exitedMs = new Date(seg.exited_at).getTime();
      totalMs += (exitedMs - enteredMs);
    } else {
      // Open segment - calculate up to now
      hasOpenSegment = true;
      const enteredMs = new Date(seg.entered_at).getTime();
      const nowMs = Date.now();
      totalMs += (nowMs - enteredMs);
    }
  });
  
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60));
  
  return {
    total_seconds: totalSeconds,
    total_minutes: totalMinutes,
    segment_count: merged.length,
    first_entry: firstEntry,
    last_exit: lastExit,
    is_currently_in_room: hasOpenSegment,
  };
}

/**
 * Get active (open) segment for participant
 */
export function getActiveSegment(segments: ParticipantTimeSegment[]): ParticipantTimeSegment | null {
  return segments.find(seg => seg.exited_at === null) ?? null;
}

/**
 * Close all open segments with reason
 */
export function closeAllSegments(
  segments: ParticipantTimeSegment[],
  reason: SegmentClosedReason
): ParticipantTimeSegment[] {
  return segments.map(seg => 
    seg.exited_at === null ? closeSegment(seg, reason) : seg
  );
}
