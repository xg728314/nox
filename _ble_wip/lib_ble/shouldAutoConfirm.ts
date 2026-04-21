// BLE Phase B: Auto-confirm condition checker
// Returns true ONLY when ALL safety conditions are met

import type { BleEntryRecommendation } from "./recommendationTypes";
import { isInDismissCooldown, isActivelySnoozed } from "./recommendationDedupe";
import { getRooms, getActiveSessions } from "@/lib/counterStore";

/**
 * Phase B: Check if recommendation should be auto-confirmed
 * 
 * Returns TRUE only if ALL conditions pass:
 * - confidence_score ≥ 0.95
 * - stable_seen_seconds ≥ 20
 * - exactly ONE room candidate (no ambiguity)
 * - room.status === "EMPTY"
 * - tag is linked to valid person
 * - NOT in dismiss cooldown
 * - NOT in snooze window
 * - no existing active participant/session conflict
 * 
 * If ANY condition fails → returns FALSE
 */
export function shouldAutoConfirm(recommendation: Partial<BleEntryRecommendation>): boolean {
  // Condition 1: Confidence must be extremely high (≥ 0.95)
  if ((recommendation.confidence_score ?? 0) < 0.95) {
    return false;
  }
  
  // Condition 2: Stable presence must be long enough (≥ 20s)
  if ((recommendation.stable_seen_seconds ?? 0) < 20) {
    return false;
  }
  
  // Condition 3: Must have valid person linkage
  if (!recommendation.hostess_name || !recommendation.tag_id) {
    return false;
  }
  
  // Condition 4: Must have exactly one room (no ambiguity)
  if (!recommendation.room_uuid || !recommendation.room_id) {
    return false;
  }
  
  // Condition 5: Room must be EMPTY
  const rooms = getRooms();
  const targetRoom = rooms.find(r => String(r.id) === recommendation.room_id);
  if (!targetRoom || targetRoom.status !== "EMPTY") {
    return false;
  }
  
  // Condition 6: Check for existing session conflict
  const activeSessions = getActiveSessions();
  const hasConflict = activeSessions.some(session =>
    session.managerName === recommendation.manager_name
  );
  if (hasConflict) {
    return false;
  }
  
  // Condition 7: NOT in dismiss cooldown
  if (recommendation.dismissed_at && isInDismissCooldown(recommendation as BleEntryRecommendation)) {
    return false;
  }
  
  // Condition 8: NOT in snooze window
  if (recommendation.snoozed_until && isActivelySnoozed(recommendation as BleEntryRecommendation)) {
    return false;
  }
  
  // All conditions passed
  return true;
}
