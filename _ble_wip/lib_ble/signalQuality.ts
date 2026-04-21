/**
 * P2-01-B: BLE Signal Quality — RSSI-based reliability, merge window, degradation detection.
 * Assist-only; no auto check-in/check-out.
 */

import type { BLEEvent } from "./events";

/** RSSI range: typical BLE -30 (excellent) to -100 (very weak). */
const RSSI_EXCELLENT = -50;
const RSSI_POOR = -85;
const RSSI_FLOOR = -100;

/** Time window (ms) to merge duplicate-ish events (same tag+event_type). */
export const MERGE_WINDOW_MS = 3000;

/** Max RSSI samples per tag to keep for sliding window. */
const RSSI_WINDOW_SIZE = 20;

/** Max age (ms) of last sample to consider "recent" for quality. */
const RECENT_MS = 60_000;

export type ReliabilityLevel = "good" | "fair" | "weak" | "unknown";

export interface TagSignalState {
  tagId: string;
  lastRssi: number | null;
  lastSeenTs: number;
  /** 0–100; higher = more reliable. */
  reliabilityScore: number;
  level: ReliabilityLevel;
  /** True if recent RSSI trend is declining. */
  qualityDegraded: boolean;
  sampleCount: number;
}

const tagRssiWindows = new Map<string, number[]>();
const tagLastSeen = new Map<string, number>();

/**
 * Compute reliability score (0–100) from RSSI.
 * -50 and above => 100, -85 => ~35, -100 => 0.
 */
export function rssiToScore(rssi: number | null | undefined): number {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) return 0;
  const r = Math.max(RSSI_FLOOR, Math.min(RSSI_EXCELLENT, rssi));
  const span = RSSI_EXCELLENT - RSSI_FLOOR;
  const p = (r - RSSI_FLOOR) / span;
  return Math.round(Math.max(0, Math.min(100, p * 100)));
}

/**
 * Map score to level for OPS HUD display.
 */
export function scoreToLevel(score: number): ReliabilityLevel {
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

/**
 * Update last-seen time for a tag (any event). Call from BLE event handler for every event.
 */
export function updateTagLastSeen(tagId: string, ts: number): void {
  tagLastSeen.set(tagId, ts);
}

/**
 * Push RSSI sample for a tag (sliding window). Call from BLE event handler.
 * Only pushes when rssi is finite (does not pollute window with sentinels).
 */
export function pushRssiSample(tagId: string, rssi: number, ts: number): void {
  if (!Number.isFinite(rssi)) return;
  const arr = tagRssiWindows.get(tagId) ?? [];
  arr.push(rssi);
  if (arr.length > RSSI_WINDOW_SIZE) arr.shift();
  tagRssiWindows.set(tagId, arr);
  tagLastSeen.set(tagId, ts);
}

/**
 * Get current signal state for a tag (for OPS HUD / monitoring).
 */
export function getTagSignalState(tagId: string): TagSignalState {
  const now = Date.now();
  const samples = tagRssiWindows.get(tagId) ?? [];
  const lastTs = tagLastSeen.get(tagId) ?? 0;

  let lastRssi: number | null = null;
  let reliabilityScore = 0;
  let qualityDegraded = false;

  if (samples.length > 0) {
    lastRssi = samples[samples.length - 1] ?? null;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    reliabilityScore = rssiToScore(avg);
    if (samples.length >= 3) {
      const recent = samples.slice(-3);
      const older = samples.slice(-6, -3);
      if (older.length >= 2) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        qualityDegraded = recentAvg < olderAvg - 5;
      }
    }
  }

  return {
    tagId,
    lastRssi,
    lastSeenTs: lastTs,
    reliabilityScore,
    level: scoreToLevel(reliabilityScore),
    qualityDegraded,
    sampleCount: samples.length,
  };
}

/**
 * Get signal state for all tags we have seen (for tag summary).
 */
export function getAllTagSignalStates(): TagSignalState[] {
  const tagIds = new Set<string>();
  tagRssiWindows.forEach((_, id) => tagIds.add(id));
  tagLastSeen.forEach((_, id) => tagIds.add(id));
  return Array.from(tagIds).map((id) => getTagSignalState(id));
}

/**
 * Merge events: same tag + same event_type within MERGE_WINDOW_MS → keep one (best RSSI).
 * Returns merged list (newest-first for display). Does not mutate input.
 */
export function mergeDuplicateEvents(events: BLEEvent[]): BLEEvent[] {
  if (events.length <= 1) return [...events];

  const byKey = new Map<string, BLEEvent>();
  const sorted = [...events].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  for (const e of sorted) {
    const key = `${e.tag_id}|${e.event_type}`;
    const existing = byKey.get(key);
    const eRssi = e.rssi ?? -100;
    if (!existing) {
      byKey.set(key, e);
      continue;
    }
    const windowOk = Math.abs((e.ts ?? 0) - (existing.ts ?? 0)) <= MERGE_WINDOW_MS;
    if (!windowOk) {
      byKey.set(key, e);
      continue;
    }
    const existingRssi = existing.rssi ?? -100;
    if (eRssi > existingRssi) byKey.set(key, e);
  }

  return Array.from(byKey.values()).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}

/**
 * Detect if signal quality is degraded for a tag (for assist hints).
 */
export function isQualityDegraded(tagId: string): boolean {
  return getTagSignalState(tagId).qualityDegraded;
}
