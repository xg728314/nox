// BLE Phase A: Recommendation dedupe and cooldown helpers

import type { BleEntryRecommendation } from "./recommendationTypes";

/**
 * Generate dedupe key for recommendation
 * Same tag in same room = same recommendation
 */
export function generateRecommendationDedupeKey(tagId: string, roomUuid: string): string {
  return `${tagId}:${roomUuid}`;
}

/**
 * Check if recommendation is in dismiss cooldown period
 * Cooldown: 60 seconds after dismiss
 */
export function isInDismissCooldown(recommendation: BleEntryRecommendation): boolean {
  if (recommendation.status !== "dismissed" || !recommendation.dismissed_at) {
    return false;
  }
  
  const dismissedAt = new Date(recommendation.dismissed_at);
  const cooldownEnd = new Date(dismissedAt.getTime() + 60_000); // 60s cooldown
  const now = new Date();
  
  return now < cooldownEnd;
}

/**
 * Check if recommendation is actively snoozed
 * Snooze: 60 seconds from snooze time
 */
export function isActivelySnoozed(recommendation: BleEntryRecommendation): boolean {
  if (recommendation.status !== "snoozed" || !recommendation.snoozed_until) {
    return false;
  }
  
  const snoozeEnd = new Date(recommendation.snoozed_until);
  const now = new Date();
  
  return now < snoozeEnd;
}

/**
 * Check if recommendation has expired
 * Expiry: 120 seconds from creation
 */
export function hasExpired(recommendation: BleEntryRecommendation): boolean {
  const expiresAt = new Date(recommendation.expires_at);
  const now = new Date();
  
  return now >= expiresAt;
}

/**
 * Calculate stable duration in seconds
 */
export function calculateStableDuration(firstSeenAt: string, lastSeenAt: string): number {
  const first = new Date(firstSeenAt);
  const last = new Date(lastSeenAt);
  const durationMs = last.getTime() - first.getTime();
  return Math.max(0, Math.floor(durationMs / 1000));
}
