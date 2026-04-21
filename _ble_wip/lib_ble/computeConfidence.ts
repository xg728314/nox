// BLE Phase A: Confidence scoring for entry recommendations
// Explainable, no black-box heuristics

import type { BleConfidenceResult } from "./recommendationTypes";

export interface ConfidenceInput {
  stable_seen_seconds: number;
  rssi: number | null;
  room_count: number;              // How many rooms detected
  observation_count: number;        // Number of BLE events seen
  has_tag_linkage: boolean;
  has_room_mapping: boolean;
}

/**
 * Compute confidence score for entry recommendation
 * Returns score 0.0-1.0 and reason code
 * 
 * Phase A: Conservative, explainable scoring
 */
export function computeConfidence(input: ConfidenceInput): BleConfidenceResult {
  let score = 0.0;
  let reason = "unknown";
  
  // Base validation
  if (!input.has_tag_linkage) {
    return { confidence_score: 0.0, reason_code: "tag_unlinked" };
  }
  
  if (!input.has_room_mapping) {
    return { confidence_score: 0.0, reason_code: "room_unmapped" };
  }
  
  // Ambiguity check: multiple rooms
  if (input.room_count > 1) {
    return { confidence_score: 0.3, reason_code: "competing_rooms" };
  }
  
  if (input.room_count === 0) {
    return { confidence_score: 0.0, reason_code: "no_room" };
  }
  
  // Start with base score
  score = 0.5;
  reason = "base";
  
  // Factor 1: Stable duration (0-30s range)
  // 15s+ = good, 20s+ = excellent
  if (input.stable_seen_seconds >= 20) {
    score += 0.3;
    reason = "stable_long";
  } else if (input.stable_seen_seconds >= 15) {
    score += 0.2;
    reason = "stable_medium";
  } else if (input.stable_seen_seconds >= 10) {
    score += 0.1;
    reason = "stable_short";
  } else {
    score += 0.0;
    reason = "unstable";
  }
  
  // Factor 2: Signal strength (if available)
  if (input.rssi !== null) {
    if (input.rssi > -60) {
      score += 0.15;
      reason = reason + "_strong_signal";
    } else if (input.rssi > -70) {
      score += 0.1;
      reason = reason + "_good_signal";
    } else if (input.rssi > -80) {
      score += 0.05;
      reason = reason + "_weak_signal";
    } else {
      score += 0.0;
      reason = reason + "_very_weak";
    }
  }
  
  // Factor 3: Observation count
  if (input.observation_count >= 5) {
    score += 0.05;
    reason = reason + "_repeated";
  }
  
  // Cap at 1.0
  score = Math.min(1.0, score);
  
  // Final reason code based on score
  if (score >= 0.9) {
    reason = "high_confidence_" + reason;
  } else if (score >= 0.7) {
    reason = "medium_confidence_" + reason;
  } else if (score >= 0.5) {
    reason = "low_confidence_" + reason;
  } else {
    reason = "very_low_" + reason;
  }
  
  return {
    confidence_score: Math.round(score * 100) / 100, // Round to 2 decimals
    reason_code: reason,
  };
}
