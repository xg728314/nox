/**
 * S-BLE-18B: Anomaly Event Stats
 * Fetches aggregated alert event statistics from DB for pattern-based anomaly detection
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AnomalyEventStat {
  alert_type: string;
  entity_type: string;
  entity_value: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
}

export interface AnomalyEventStats {
  stats: AnomalyEventStat[];
  error?: string;
}

/**
 * Fetch anomaly event statistics from DB
 * Calls public.get_ble_anomaly_event_stats() RPC
 * @param supabase - Supabase client
 * @returns Event stats with fail-soft error handling
 */
export async function fetchAnomalyEventStats(
  supabase: SupabaseClient | null
): Promise<AnomalyEventStats> {
  if (!supabase) {
    return {
      stats: [],
      error: "Supabase client not available",
    };
  }

  try {
    const { data, error } = await supabase.rpc("get_ble_anomaly_event_stats");

    if (error) {
      console.error("[anomalyEventStats] RPC error:", error);
      return {
        stats: [],
        error: `RPC failed: ${error.message}`,
      };
    }

    if (!Array.isArray(data)) {
      return {
        stats: [],
        error: "RPC returned non-array result",
      };
    }

    return {
      stats: data.map((row: any) => ({
        alert_type: String(row.alert_type ?? ""),
        entity_type: String(row.entity_type ?? ""),
        entity_value: String(row.entity_value ?? ""),
        event_count: Number(row.event_count ?? 0),
        first_seen: String(row.first_seen ?? ""),
        last_seen: String(row.last_seen ?? ""),
      })),
    };
  } catch (e) {
    console.error("[anomalyEventStats] Unexpected error:", e);
    return {
      stats: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Group event stats by entity type
 */
export function groupStatsByEntity(stats: AnomalyEventStat[]): {
  ip: AnomalyEventStat[];
  gateway_id: AnomalyEventStat[];
  room_id: AnomalyEventStat[];
} {
  return {
    ip: stats.filter((s) => s.entity_type === "ip"),
    gateway_id: stats.filter((s) => s.entity_type === "gateway_id"),
    room_id: stats.filter((s) => s.entity_type === "room_id"),
  };
}
