/**
 * P2-01-B: Assist Hints — entry possibility, departure suspected.
 * OPS HUD display only; no auto check-in/check-out.
 */

import type { BLEEvent } from "./events";
import { getTagSignalState, rssiToScore } from "./signalQuality";

export type EntryPossibility = "high" | "low" | "unknown";

export type AssistHintState = "normal" | "caution" | "suspected";

export interface TagAssistHint {
  tagId: string;
  roomId: string | number | null;
  /** Entry possibility for this tag (from recent ENTER + RSSI). */
  entryPossibility: EntryPossibility;
  /** Departure suspected: hint only, not confirmed. */
  departureSuspected: boolean;
  state: AssistHintState;
  lastEventType: "ENTER" | "EXIT" | "HEARTBEAT" | "UNKNOWN";
  lastEventTs: number;
}

/** Threshold (ms): no signal for this long → consider "departure suspected" hint. */
const DEPARTURE_SUSPECTED_MS = 2 * 60 * 1000;

/** RSSI above this => entry possibility high (when combined with recent ENTER). */
const RSSI_ENTRY_HIGH = -65;

/** Minimum score for "high" entry possibility. */
const SCORE_ENTRY_HIGH = 60;

/**
 * Compute assist hints from recent events and tag signal state.
 * Does not perform any auto action; for OPS HUD display only.
 */
export function computeAssistHints(
  recentEvents: BLEEvent[],
  tagLastSeenMap: Map<string, number>
): TagAssistHint[] {
  const now = Date.now();
  const byTag = new Map<string, TagAssistHint>();

  for (const e of recentEvents) {
    const tagId = e.tag_id;
    const lastSeen = tagLastSeenMap.get(tagId) ?? e.ts ?? 0;
    const signalState = getTagSignalState(tagId);
    const score = signalState.reliabilityScore;
    const rssi = e.rssi ?? null;

    let entryPossibility: EntryPossibility = "unknown";
    if (e.event_type === "ENTER" && e.room_id != null) {
      if (rssi !== null && rssi >= RSSI_ENTRY_HIGH) entryPossibility = "high";
      else if (score >= SCORE_ENTRY_HIGH) entryPossibility = "high";
      else if (score > 0) entryPossibility = "low";
    }

    const noSignalMs = now - lastSeen;
    const departureSuspected =
      noSignalMs >= DEPARTURE_SUSPECTED_MS &&
      (e.event_type === "ENTER" || e.event_type === "HEARTBEAT") &&
      e.room_id != null;

    let state: AssistHintState = "normal";
    if (departureSuspected) state = "suspected";
    else if (signalState.qualityDegraded || entryPossibility === "low") state = "caution";

    const existing = byTag.get(tagId);
    const ts = e.ts ?? 0;
    if (!existing || ts >= (existing.lastEventTs ?? 0)) {
      byTag.set(tagId, {
        tagId,
        roomId: e.room_id ?? null,
        entryPossibility: entryPossibility !== "unknown" ? entryPossibility : (existing?.entryPossibility ?? "unknown"),
        departureSuspected: departureSuspected || (existing?.departureSuspected ?? false),
        state,
        lastEventType: e.event_type,
        lastEventTs: ts,
      });
    }
  }

  return Array.from(byTag.values());
}

/**
 * Single-tag hint from signal state and last event (for room tile).
 */
export function getTagHint(
  tagId: string,
  lastEvent: BLEEvent | null,
  lastSeenTs: number
): Pick<TagAssistHint, "entryPossibility" | "departureSuspected" | "state"> {
  const now = Date.now();
  const signalState = getTagSignalState(tagId);
  const score = signalState.reliabilityScore;
  const rssi = lastEvent?.rssi ?? null;

  let entryPossibility: EntryPossibility = "unknown";
  if (lastEvent?.event_type === "ENTER" && lastEvent?.room_id != null) {
    if (rssi !== null && rssi >= RSSI_ENTRY_HIGH) entryPossibility = "high";
    else if (score >= SCORE_ENTRY_HIGH) entryPossibility = "high";
    else if (score > 0) entryPossibility = "low";
  }

  const noSignalMs = now - lastSeenTs;
  const departureSuspected =
    noSignalMs >= DEPARTURE_SUSPECTED_MS &&
    lastEvent != null &&
    (lastEvent.event_type === "ENTER" || lastEvent.event_type === "HEARTBEAT") &&
    lastEvent.room_id != null;

  let state: AssistHintState = "normal";
  if (departureSuspected) state = "suspected";
  else if (signalState.qualityDegraded || entryPossibility === "low") state = "caution";

  return { entryPossibility, departureSuspected, state };
}
