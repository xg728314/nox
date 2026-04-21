/**
 * BLE presence pipeline types (receiver-based scans → IN/OUT → alerts).
 */

export type PresenceStateRow = {
  id: string;
  store_id: string;
  tag_id: string;
  receiver_id: string;
  room_id: number | null;
  state: "IN" | "OUT";
  last_seen_at: string;
  last_change_at: string;
};

export type ScanInput = {
  tag_id: string;
  rssi: number | null;
  seen_at: string; // ISO
};

export type IngestReceiverPayload = {
  store_id: string;
  receiver_id: string;
  scans: ScanInput[];
};

export type LeaveTransition = {
  store_id: string;
  tag_id: string;
  receiver_id: string;
  room_id: number | null;
  hostess_profile_id: string | null;
  room_manager_profile_id: string | null;
  girl_manager_profile_id: string | null;
};
