/**
 * Location correction error types.
 *
 * Shared by:
 *   - API (app/api/location/correct/route.ts) for auto-classification
 *   - UI (BleCorrectionModal, LocationCorrectionSheet) for dropdown
 *   - DB CHECK constraint (database/054_location_correction_logs.sql)
 *
 * If values change here the migration CHECK must also change.
 */

export const ERROR_TYPES = [
  "ROOM_MISMATCH",
  "STORE_MISMATCH",
  "HALLWAY_DRIFT",
  "ELEVATOR_ZONE",
  "MANUAL_INPUT_ERROR",
] as const

export type ErrorType = typeof ERROR_TYPES[number]

export const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  ROOM_MISMATCH:      "방 오탐",
  STORE_MISMATCH:     "매장 오탐",
  HALLWAY_DRIFT:      "복도 드리프트",
  ELEVATOR_ZONE:      "엘리베이터 오탐",
  MANUAL_INPUT_ERROR: "수동 입력 오류",
}

export function isErrorType(v: unknown): v is ErrorType {
  return typeof v === "string" && (ERROR_TYPES as readonly string[]).includes(v)
}

/**
 * Auto-classify based on detected vs. corrected locations.
 *
 * Priority (first match wins):
 *   1. different store                    → STORE_MISMATCH
 *   2. elevator involved on either side   → ELEVATOR_ZONE
 *   3. detected != room && corrected=room → HALLWAY_DRIFT
 *   4. both room, different room_uuid     → ROOM_MISMATCH
 *   5. fallback                           → MANUAL_INPUT_ERROR
 *
 * Null-safe: NULL store/room is treated as unknown, never equal.
 */
export function classifyErrorType(input: {
  detected_store_uuid: string | null
  detected_room_uuid:  string | null
  detected_zone:       string | null
  corrected_store_uuid: string | null
  corrected_room_uuid:  string | null
  corrected_zone:       string
}): ErrorType {
  const { detected_store_uuid: ds, detected_room_uuid: dr, detected_zone: dz,
          corrected_store_uuid: cs, corrected_room_uuid: cr, corrected_zone: cz } = input

  // 1. cross-store misclassification
  if (ds && cs && ds !== cs) return "STORE_MISMATCH"

  // 2. elevator on either side
  if (cz === "elevator" || dz === "elevator") return "ELEVATOR_ZONE"

  // 3. hallway drift — detected non-room (e.g., unknown/counter/external_floor)
  //    while the actual location is a room
  if (cz === "room" && dz !== "room") return "HALLWAY_DRIFT"

  // 4. both rooms, different room
  if (cz === "room" && dz === "room" && dr && cr && dr !== cr) return "ROOM_MISMATCH"

  // 5. fallback
  return "MANUAL_INPUT_ERROR"
}
