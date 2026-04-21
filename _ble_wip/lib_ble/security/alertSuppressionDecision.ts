/**
 * S-BLE-16 → S-BLE-17: Alert Suppression Decision Logic with Observability
 * 
 * Redis remains an optional fast-path hint only.
 * DB RPC public.try_mark_ble_alert_suppression(...) is the final authority.
 * 
 * Flow:
 * 1. Build suppression key
 * 2. If Redis enabled, do fast precheck
 *    - if key exists => suppress immediately
 * 3. Otherwise call DB RPC final gate
 * 4. If DB returns true => send alert
 * 5. If DB returns false => suppress
 * 6. After DB decision, write Redis TTL as best-effort cache
 * 7. Redis failures must never block flow
 * 8. DB remains source of truth
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Redis from "ioredis";
import { alertMetrics } from "./alertMetrics";

export type SuppressionDecisionSource = "redis" | "db" | "fail_open";

export interface SuppressionDecisionResult {
  shouldSend: boolean;
  decisionSource: SuppressionDecisionSource;
  reason: string;
  suppressionKey: string;
}

/**
 * Decide whether to send or suppress an alert.
 * 
 * @param suppressionKey - Unique key for this alert type/entity
 * @param cooldownSec - Cooldown period in seconds
 * @param redis - Optional Redis client for fast-path hint
 * @param supabase - Supabase client for DB RPC (required for final authority)
 * @returns Decision result with metadata
 */
export async function decideAlertSuppression(
  suppressionKey: string,
  cooldownSec: number,
  redis: Redis | null,
  supabase: SupabaseClient | null
): Promise<SuppressionDecisionResult> {
  // Step 1: Redis fast-path precheck (if available)
  if (redis) {
    try {
      const redisValue = await redis.get(suppressionKey);
      if (redisValue !== null) {
        alertMetrics.increment("redis_hit");
        return {
          shouldSend: false,
          decisionSource: "redis",
          reason: "redis_hit",
          suppressionKey,
        };
      }
      alertMetrics.increment("redis_miss");
    } catch (e) {
      console.warn("[alertSuppression] Redis precheck failed:", e);
      alertMetrics.increment("redis_error");
      // Continue to DB path - Redis failure must not block
    }
  }

  // Step 2: DB RPC final authority
  if (!supabase) {
    // No DB available - fail open (send alert)
    console.warn("[alertSuppression] No DB client - fail open");
    alertMetrics.increment("fail_open");
    return {
      shouldSend: true,
      decisionSource: "fail_open",
      reason: "no_db_client",
      suppressionKey,
    };
  }

  try {
    const { data, error } = await supabase.rpc("try_mark_ble_alert_suppression", {
      p_key: suppressionKey,
      p_cooldown_sec: cooldownSec,
    });

    if (error) {
      console.warn("[alertSuppression] DB RPC error:", error.message);
      alertMetrics.increment("db_error");
      alertMetrics.increment("fail_open");
      // Fail open on DB error
      return {
        shouldSend: true,
        decisionSource: "fail_open",
        reason: "db_rpc_error",
        suppressionKey,
      };
    }

    const shouldSend = Boolean(data);

    // Record DB decision
    if (shouldSend) {
      alertMetrics.increment("db_allow");
    } else {
      alertMetrics.increment("db_suppress");
    }

    // Step 3: Redis writeback (best-effort cache)
    // Write to Redis after DB decision regardless of result
    // This caches the suppression state for fast-path on next alert
    if (redis) {
      try {
        await redis.set(suppressionKey, "1", "EX", cooldownSec);
      } catch (e) {
        console.warn("[alertSuppression] Redis writeback failed:", e);
        alertMetrics.increment("redis_error");
        // Non-critical - continue
      }
    }

    return {
      shouldSend,
      decisionSource: "db",
      reason: shouldSend ? "db_allows" : "db_suppresses",
      suppressionKey,
    };
  } catch (e) {
    console.warn("[alertSuppression] DB RPC exception:", e);
    alertMetrics.increment("db_error");
    alertMetrics.increment("fail_open");
    // Fail open
    return {
      shouldSend: true,
      decisionSource: "fail_open",
      reason: "db_rpc_exception",
      suppressionKey,
    };
  }
}
