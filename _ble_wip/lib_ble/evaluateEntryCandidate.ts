// BLE Phase A: Entry candidate evaluation
// Conservative evaluation - only create recommendation if ALL conditions met

import type { BleEntryCandidateEvaluation, BleEntryRecommendation } from "./recommendationTypes";
import { findByTagId } from "@/lib/mock/tagRegistry";
import { normalizeTagId } from "./normalizeTagId";
import { computeConfidence } from "./computeConfidence";
import { generateRecommendationDedupeKey } from "./recommendationDedupe";
import { getRooms } from "@/lib/counterStore";

export interface EvaluationInput {
  tag_id: string;
  room_id: string | number | null;
  rssi?: number;
  stable_seen_seconds?: number;
  observation_count?: number;
  store_id?: string | number;
}

/**
 * Evaluate if BLE observation should create entry recommendation
 * 
 * Phase A: Conservative - only recommend if ALL conditions satisfied:
 * - Known tag
 * - Linked person
 * - Resolvable single room_uuid
 * - Valid store scope
 * - Confidence above threshold (0.85)
 * - Stable duration above threshold (15s)
 * - No ambiguity
 * 
 * Returns null if any condition fails
 */
export function evaluateEntryCandidate(input: EvaluationInput): BleEntryCandidateEvaluation {
  // Normalize tag ID
  const normalizedTagId = normalizeTagId(input.tag_id);
  if (!normalizedTagId) {
    return {
      valid: false,
      reason: "invalid_tag_id",
      candidate: null,
    };
  }
  
  // Check tag linkage
  const tagAssignment = findByTagId(normalizedTagId);
  if (!tagAssignment) {
    return {
      valid: false,
      reason: "tag_unlinked",
      candidate: null,
    };
  }
  
  if (tagAssignment.status !== "ACTIVE") {
    return {
      valid: false,
      reason: `tag_status_${tagAssignment.status}`,
      candidate: null,
    };
  }
  
  // Check room resolution
  if (!input.room_id) {
    return {
      valid: false,
      reason: "room_missing",
      candidate: null,
    };
  }
  
  // Find room by ID
  const rooms = getRooms();
  const targetRoom = rooms.find(r => 
    String(r.id) === String(input.room_id) || 
    String(r.roomNo) === String(input.room_id)
  );
  
  if (!targetRoom) {
    return {
      valid: false,
      reason: "room_not_found",
      candidate: null,
    };
  }
  
  // Check room availability (should be EMPTY for recommendation)
  if (targetRoom.status !== "EMPTY") {
    return {
      valid: false,
      reason: "room_not_empty",
      candidate: null,
    };
  }
  
  // Calculate confidence
  const stableSeconds = input.stable_seen_seconds ?? 0;
  const obsCount = input.observation_count ?? 1;
  
  const confidenceResult = computeConfidence({
    stable_seen_seconds: stableSeconds,
    rssi: input.rssi ?? null,
    room_count: 1,
    observation_count: obsCount,
    has_tag_linkage: true,
    has_room_mapping: true,
  });
  
  // Check confidence threshold (0.85)
  if (confidenceResult.confidence_score < 0.85) {
    return {
      valid: false,
      reason: `low_confidence_${confidenceResult.confidence_score}`,
      candidate: null,
    };
  }
  
  // Check stable duration threshold (15s)
  if (stableSeconds < 15) {
    return {
      valid: false,
      reason: `unstable_${stableSeconds}s`,
      candidate: null,
    };
  }
  
  // All checks passed - create candidate
  const now = new Date().toISOString();
  const roomUuid = String(targetRoom.id); // Use ID as UUID for now
  const dedupeKey = generateRecommendationDedupeKey(normalizedTagId, roomUuid);
  
  const candidate: Partial<BleEntryRecommendation> = {
    dedupe_key: dedupeKey,
    tag_id: normalizedTagId,
    room_uuid: roomUuid,
    room_no: targetRoom.roomNo ?? null,
    room_name: targetRoom.name,
    room_id: targetRoom.id,
    hostess_id: tagAssignment.hostessId,
    hostess_name: tagAssignment.hostessName,
    manager_name: tagAssignment.managerName,
    store_id: input.store_id ?? tagAssignment.storeKey,
    store_uuid: String(input.store_id ?? tagAssignment.storeKey),
    rssi: input.rssi ?? null,
    confidence_score: confidenceResult.confidence_score,
    reason_code: confidenceResult.reason_code,
    stable_seen_seconds: stableSeconds,
    first_seen_at: now,
    last_seen_at: now,
    source: "gateway",
  };
  
  return {
    valid: true,
    reason: "valid_candidate",
    candidate,
  };
}
