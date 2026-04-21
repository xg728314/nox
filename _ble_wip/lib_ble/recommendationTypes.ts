// BLE Phase A: Recommendation type definitions
// Recommendation mode ONLY - no direct auto-checkin

export type BleEntryRecommendationStatus =
  | "candidate"    // Active, visible to operator
  | "confirmed"    // Operator accepted (or auto-confirmed)
  | "dismissed"    // Operator rejected
  | "snoozed"      // Temporarily hidden
  | "expired";     // Timed out without action

export type BleEntryRecommendationSource = 
  | "gateway"      // From BLE gateway event
  | "manual";      // Manual override/test

export type BleDecisionSource =
  | "manual"       // Manual confirmation
  | "auto";        // Auto-confirmed (Phase B)

/**
 * BLE Entry Recommendation
 * Phase A: Recommendation only, no direct auto-checkin
 */
export interface BleEntryRecommendation {
  // Identity
  id: string;                          // UUID
  dedupe_key: string;                  // tag_id:room_uuid (for deduplication)
  
  // Store/Room Context
  store_uuid: string;
  store_id: string | number;           // Legacy compat
  room_uuid: string;
  room_no: number | null;              // Display only
  room_name: string | null;
  room_id: string;                     // Internal room ID
  
  // Session Context (may be null if no active session yet)
  session_id: string | null;
  
  // Person/Tag Linkage
  tag_id: string;                      // Normalized
  hostess_id: string | null;
  hostess_name: string | null;
  manager_name: string | null;
  
  // Detection Metadata
  gateway_id: string | null;
  rssi: number | null;
  
  // Confidence & Timing
  confidence_score: number;            // 0.0 to 1.0
  reason_code: string;                 // e.g., "stable_single_room"
  stable_seen_seconds: number;         // How long stable presence
  first_seen_at: string;               // ISO timestamp
  last_seen_at: string;                // ISO timestamp
  
  // Lifecycle
  status: BleEntryRecommendationStatus;
  created_at: string;                  // ISO timestamp
  updated_at: string;                  // ISO timestamp
  expires_at: string;                  // ISO timestamp (created_at + 120s)
  snoozed_until: string | null;        // ISO timestamp if snoozed
  dismissed_at: string | null;
  confirmed_at: string | null;
  
  // Audit
  source: BleEntryRecommendationSource;
  operator_id: string | null;          // Who confirmed/dismissed
  decision_source?: BleDecisionSource;  // Phase B: manual vs auto
}

/**
 * Confidence calculation result
 */
export interface BleConfidenceResult {
  confidence_score: number;            // 0.0 to 1.0
  reason_code: string;                 // Explanation
}

/**
 * Candidate evaluation result
 */
export interface BleEntryCandidateEvaluation {
  valid: boolean;
  reason: string;
  candidate: Partial<BleEntryRecommendation> | null;
}
