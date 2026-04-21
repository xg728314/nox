/**
 * S-BLE-10 → S-BLE-13 → S-BLE-16: Alert threshold orchestrator
 * Detects repeated failures using distributed-safe backend
 * Priority: Redis → DB → Memory
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThresholdBackend } from "./thresholdBackend";
import { DbThresholdBackend } from "./dbThreshold";
import { MemoryThresholdBackend } from "./memoryThreshold";
import { RedisThresholdBackend } from "./redisThreshold";
import { getRedisClient } from "./redisClient";

const ALERT_WINDOW_MS = 5 * 60 * 1000; // 5분
const ALERT_THRESHOLD = 5; // 5회 이상

let redisBackend: ThresholdBackend | null = null;
let dbBackend: ThresholdBackend | null = null;
const memoryFallback = new MemoryThresholdBackend();

async function getBackend(supabase: SupabaseClient | null): Promise<ThresholdBackend> {
  try {
    const redis = await getRedisClient();
    if (redis && !redisBackend) {
      redisBackend = new RedisThresholdBackend(redis);
    }
    if (redisBackend) return redisBackend;
  } catch (e) {
    console.warn("[alertThreshold] Redis backend unavailable:", e);
  }

  if (supabase && !dbBackend) {
    dbBackend = new DbThresholdBackend(supabase);
  }
  if (dbBackend) return dbBackend;

  return memoryFallback;
}

/**
 * Track a failure and return true if alert threshold is exceeded.
 * S-BLE-16: Priority - Redis → DB → Memory
 * @param key - unique key (e.g., "ble:threshold:auth_invalid:ip:192.168.1.100")
 * @param supabase - Supabase client (null for memory fallback)
 * @returns true if threshold exceeded (alert should be sent)
 */
export async function shouldAlertRepeatedFailure(
  key: string,
  supabase: SupabaseClient | null = null
): Promise<boolean> {
  try {
    const backend = await getBackend(supabase);
    return await backend.checkThreshold(key, ALERT_WINDOW_MS, ALERT_THRESHOLD);
  } catch (e) {
    console.warn("[alertThreshold] Backend error, using false:", e);
    return false;
  }
}

/**
 * Reset failure tracking for a key.
 */
export function resetFailureTracking(key: string): void {
  if (memoryFallback) {
    memoryFallback["failureStore"]?.delete(key);
  }
}
