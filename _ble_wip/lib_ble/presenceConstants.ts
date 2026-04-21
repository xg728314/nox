/**
 * BLE presence resolver parameters (MVP).
 * - T: consider tag "IN" if last_seen_at within T seconds.
 * - LEAVE: transition to OUT when no sightings for T seconds (or switch receiver/room).
 * - Debounce ENTER: require 2 consecutive scans within ENTER_DEBOUNCE_SEC to confirm IN.
 */

export const PRESENCE_T_SEC = 20;
export const PRESENCE_ENTER_DEBOUNCE_SEC = 10;
export const RSSI_THRESHOLD = -85;
