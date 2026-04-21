/**
 * Phase E: Segment-based billing time adapter
 * Converts participant time segments into settlement-ready billing time.
 * 
 * IMPORTANT: This is the bridge between segment engine and settlement calculation.
 */

import { computeTotalTime } from "./segmentHelpers";
import type { ParticipantTimeSegment } from "./segmentTypes";

export type BillingTimeResult = {
  total_minutes: number;
  billable_minutes: number;
  segment_count: number;
  has_open_segment: boolean;
  first_entry: string | null;
  last_exit: string | null;
  source: "segment" | "empty";
};

/**
 * Get billable time from participant segments
 * 
 * Rules:
 * - Closed segments: count full duration
 * - Open segments: count up to now
 * - Merged segments: already handled by computeTotalTime
 * - Billable = total (conservative approach)
 * 
 * @param segments - All segments for this participant
 * @returns Billing time ready for settlement calculation
 */
export function getSegmentBasedBillingTime(
  segments: ParticipantTimeSegment[]
): BillingTimeResult {
  if (segments.length === 0) {
    return {
      total_minutes: 0,
      billable_minutes: 0,
      segment_count: 0,
      has_open_segment: false,
      first_entry: null,
      last_exit: null,
      source: "empty",
    };
  }
  
  const computed = computeTotalTime(segments);
  
  // Conservative billable time = total time
  // (Future: could apply billing rules here if needed)
  const billableMinutes = computed.total_minutes;
  
  return {
    total_minutes: computed.total_minutes,
    billable_minutes: billableMinutes,
    segment_count: computed.segment_count,
    has_open_segment: computed.is_currently_in_room,
    first_entry: computed.first_entry,
    last_exit: computed.last_exit,
    source: "segment",
  };
}

/**
 * Get segment-based adjustment minutes for settlement
 * 
 * Compares actual segment time to plan base time.
 * Returns the delta for settlement adjustment.
 * 
 * @param segmentMinutes - Actual minutes from segments
 * @param planBaseMinutes - Expected base minutes (90 for full, 45 for half, etc.)
 * @returns Adjustment minutes (can be negative)
 */
export function computeSegmentAdjustment(
  segmentMinutes: number,
  planBaseMinutes: number
): number {
  return segmentMinutes - planBaseMinutes;
}
