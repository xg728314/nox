/**
 * BLE presence resolver (deterministic).
 * - IN: last_seen within T sec on receiver mapped to room; debounce: 2 scans within ENTER_DEBOUNCE_SEC.
 * - LEAVE: previously IN, then no sightings for T sec (or switch receiver/room).
 */

import { PRESENCE_T_SEC, PRESENCE_ENTER_DEBOUNCE_SEC } from "./presenceConstants";
import type { PresenceStateRow } from "./presenceTypes";

export type ResolverInput = {
  store_id: string;
  tag_id: string;
  receiver_id: string;
  room_id: number | null;
  seen_at: string; // ISO
};

export type ResolverResult = {
  state: "IN" | "OUT";
  last_seen_at: string;
  last_change_at: string;
  transition: "ENTER" | "LEAVE" | null;
};

const T_MS = PRESENCE_T_SEC * 1000;
const ENTER_DEBOUNCE_MS = PRESENCE_ENTER_DEBOUNCE_SEC * 1000;

function parseMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Compute new presence state from current row + latest scan.
 * Does not persist; caller upserts presence_state and handles LEAVE (alerts).
 */
export function resolvePresence(
  current: PresenceStateRow | null,
  latestScan: ResolverInput,
  nowIso: string
): ResolverResult {
  const nowMs = parseMs(nowIso);
  const seenMs = parseMs(latestScan.seen_at);

  if (!current) {
    return {
      state: "IN",
      last_seen_at: latestScan.seen_at,
      last_change_at: nowIso,
      transition: "ENTER",
    };
  }

  const lastSeenMs = parseMs(current.last_seen_at);
  const lastChangeMs = parseMs(current.last_change_at);
  const sameReceiver = current.receiver_id === latestScan.receiver_id;

  if (current.state === "OUT") {
    const gap = seenMs - lastSeenMs;
    const withinDebounce = gap <= ENTER_DEBOUNCE_MS;
    if (sameReceiver && withinDebounce) {
      return {
        state: "IN",
        last_seen_at: latestScan.seen_at,
        last_change_at: nowIso,
        transition: "ENTER",
      };
    }
    return {
      state: "IN",
      last_seen_at: latestScan.seen_at,
      last_change_at: nowIso,
      transition: "ENTER",
    };
  }

  if (current.state === "IN") {
    if (!sameReceiver || current.room_id !== latestScan.room_id) {
      return {
        state: "OUT",
        last_seen_at: latestScan.seen_at,
        last_change_at: nowIso,
        transition: "LEAVE",
      };
    }
    const silenceMs = nowMs - seenMs;
    if (silenceMs >= T_MS) {
      return {
        state: "OUT",
        last_seen_at: current.last_seen_at,
        last_change_at: nowIso,
        transition: "LEAVE",
      };
    }
    return {
      state: "IN",
      last_seen_at: latestScan.seen_at,
      last_change_at: current.last_change_at,
      transition: null,
    };
  }

  return {
    state: "OUT",
    last_seen_at: latestScan.seen_at,
    last_change_at: nowIso,
    transition: null,
  };
}

/**
 * Check if existing IN state should transition to OUT by timeout only (no new scan).
 */
export function resolvePresenceTimeout(
  current: PresenceStateRow,
  nowIso: string
): ResolverResult | null {
  if (current.state !== "IN") return null;
  const nowMs = parseMs(nowIso);
  const lastSeenMs = parseMs(current.last_seen_at);
  if (nowMs - lastSeenMs < T_MS) return null;
  return {
    state: "OUT",
    last_seen_at: current.last_seen_at,
    last_change_at: nowIso,
    transition: "LEAVE",
  };
}
