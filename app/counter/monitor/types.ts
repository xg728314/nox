/**
 * Shared types for Counter Monitoring V2.
 *
 * Mirrors the shape returned by `GET /api/counter/monitor`. The client
 * never re-derives data locally — if the server didn't send it, the UI
 * doesn't render it. This keeps the policy boundary server-side.
 */

export type MonitorMode = "manual" | "hybrid"
export type ParticipantZone = "room" | "mid_out" | "unknown"
export type HomeWorkerZone = "room" | "away" | "waiting"

/**
 * Operator action derived state per participant. Reflects the LATEST row
 * in `session_participant_actions` for that participant:
 *   - normal         : no operator action recorded
 *   - still_working  : operator dismissed absence alerts (mute)
 *   - ended          : operator marked end-of-participation (monitor
 *                      hides the row on next poll)
 *   - extended       : operator recorded an extension — `extension_count`
 *                      holds the running tally
 * This does NOT reflect the underlying session_participants.status — it
 * is a parallel, audit-only layer.
 */
export type MonitorOperatorStatus = "normal" | "still_working" | "ended" | "extended"

/**
 * Server-emitted recommendation facts per participant. Server computes;
 * client only renders after user-pref filtering. Never drives state.
 */
export type MonitorRecCode =
  | "long_mid_out"
  | "long_session"
  | "overdue"
  | "extension_reminder"

export type MonitorRecommendation = {
  code: MonitorRecCode
  /** Minute count relevant to the recommendation; absent for codes
   *  whose signal is categorical (e.g., extension_reminder). */
  minutes?: number
  message: string
}

export type MonitorRoomParticipant = {
  id: string
  role: string
  category: string | null
  status: string
  zone: ParticipantZone
  membership_id: string | null
  display_name: string
  is_foreign: boolean
  origin_store_uuid: string | null
  origin_store_name: string | null
  time_minutes: number
  entered_at: string
  operator_status: MonitorOperatorStatus
  extension_count: number
  /** Most recent `session_participant_actions.id` for this participant
   *  (null if no operator action is recorded). */
  latest_action_id: string | null
  /** Cursor stored on `session_participants.last_applied_action_id` — the
   *  most recent action id that has already been applied to participant
   *  state by `/api/sessions/participants/apply-actions`. */
  last_applied_action_id: string | null
  /** Apply-state overlay for the LATEST action. Sourced from
   *  `session_participant_action_applies`. Null when no apply row
   *  exists (e.g., action predates the apply-tracking pipeline).
   *  Used by ApplyStatusBadge; never re-derived on the client. */
  latest_apply_status: "pending" | "success" | "failed" | null
  latest_apply_attempt_count: number | null
  latest_apply_last_attempted_at: string | null
  latest_apply_failure_code: string | null
  latest_apply_failure_message: string | null
  /** Server-computed recommendation facts (raw; client filters by user
   *  alert prefs). Empty array when nothing noteworthy applies. */
  recommendations: MonitorRecommendation[]
}

export type MonitorRoom = {
  room_uuid: string
  room_no: string
  room_name: string
  floor_no: number | null
  sort_order: number
  status: "active" | "empty"
  session: {
    id: string
    started_at: string
    manager_name: string | null
    customer_name_snapshot: string | null
    customer_party_size: number | null
  } | null
  participants: MonitorRoomParticipant[]
}

export type MonitorHomeWorker = {
  membership_id: string
  display_name: string
  current_zone: HomeWorkerZone
  current_room_uuid: string | null
  /** Room display name (local OR foreign room). */
  current_room_name: string | null
  /** Floor of the current room (local or foreign). */
  current_floor: number | null
  /** Store the worker is currently at. For own-store = caller's store
   *  name; for away-store = the working store's name. Other stores'
   *  internals are never surfaced beyond this label. */
  current_store_name: string | null
  /** Only set when `current_zone === "away"`. */
  working_store_uuid: string | null
  /** Session category (퍼블릭 / 셔츠 / 하퍼 / 차3) or null when waiting. */
  category: string | null
  /** Booked minutes on the current session. */
  current_time_minutes: number
  /** ISO timestamp the worker entered the current session. */
  entered_at: string | null
  /** Running extension tally from session_participant_actions. */
  extension_count: number
}

export type MonitorForeignWorker = {
  membership_id: string | null
  display_name: string
  origin_store_uuid: string | null
  origin_store_name: string | null
  session_id: string
  current_room_uuid: string | null
  entered_at: string
}

export type MonitorMovementEvent = {
  at: string
  kind: string
  actor_role: string | null
  entity_table: string | null
  entity_id: string | null
  room_uuid: string | null
  session_id: string | null
}

export type MonitorSummary = {
  present: number        // 재실
  mid_out: number        // 이탈
  restroom: number       // 화장실 (BLE-only; 0 today)
  external_floor: number // 외부(타층) (BLE-only; 0 today)
  waiting: number        // 대기
}

export type MonitorResponse = {
  store_uuid: string
  mode: MonitorMode
  generated_at: string
  summary: MonitorSummary
  rooms: MonitorRoom[]
  home_workers: MonitorHomeWorker[]
  foreign_workers: MonitorForeignWorker[]
  movement: MonitorMovementEvent[]
  ble: {
    confidence: "manual" | "ble" | "hybrid"
    presence: MonitorBlePresence[]
  }
}

export type MonitorBleZone =
  | "room"
  | "counter"
  | "restroom"
  | "elevator"
  | "external_floor"
  | "lounge"
  | "unknown"

export type MonitorBlePresence = {
  membership_id: string
  display_name: string
  zone: MonitorBleZone
  room_uuid: string | null
  last_seen_at: string
  last_event_type: string | null
  /** "ble" = raw BLE reading; "corrected" = human correction overlay.
   *  Raw BLE tables are never modified — correction is a separate
   *  append-only row in `ble_presence_corrections`. */
  source: "ble" | "corrected"
  corrected_by_membership_id?: string | null
  corrected_at?: string | null
  /** Read-time confidence computed by `lib/ble/computePresenceConfidence`.
   *  Never persisted. Drives <ConfidenceBadge>. The level is always
   *  returned; `score` and `reasons` are present but a UI in basic
   *  mode may choose to surface only `level`. */
  confidence_level: "high" | "medium" | "low"
  confidence_score: number
  confidence_reasons: string[]
}
