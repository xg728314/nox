/**
 * S-BLE-18A/18B: Anomaly Detection API
 * Returns current active anomalies based on metrics and backend status
 * S-BLE-18B: Added event stats from DB aggregation
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabaseOrError } from "@/lib/supabaseServer";
import { getRedisClient } from "@/lib/ble/security/redisClient";
import { alertMetrics } from "@/lib/ble/security/alertMetrics";
import { evaluateAnomalyRules } from "@/lib/ble/security/anomalyRules";
import { fetchAnomalyEventStats } from "@/lib/ble/security/anomalyEventStats";
import type { BackendStatus } from "@/lib/ble/security/anomalyRules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check Redis status
    let redisStatus = "unavailable";
    let redisConnected = false;
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.ping();
        redisStatus = "connected";
        redisConnected = true;
      }
    } catch (e) {
      redisStatus = "error";
    }

    // Check DB status
    let dbStatus = "unavailable";
    let dbConnected = false;
    let sbResult: ReturnType<typeof getServerSupabaseOrError> | null = null;
    try {
      const cookieStore = await cookies();
      sbResult = getServerSupabaseOrError(cookieStore);
      if (sbResult.ok) {
        const { error } = await sbResult.supabase
          .from("ble_alert_suppressions")
          .select("key", { count: "exact", head: true })
          .limit(1);
        if (!error) {
          dbStatus = "connected";
          dbConnected = true;
        } else {
          dbStatus = "error";
        }
      } else {
        dbStatus = "error";
      }
    } catch (e) {
      dbStatus = "error";
    }

    // Determine backend mode
    let backendMode = "memory";
    if (redisConnected) {
      backendMode = "redis";
    } else if (dbConnected) {
      backendMode = "db";
    }

    // Build backend status
    const backendStatus: BackendStatus = {
      backend_mode: backendMode,
      redis: {
        status: redisStatus,
        connected: redisConnected,
      },
      db: {
        status: dbStatus,
        connected: dbConnected,
      },
    };

    // Get metrics snapshot
    const metrics = alertMetrics.getSnapshot();

    // S-BLE-18B: Fetch event stats from DB
    const supabase = dbConnected && sbResult && "supabase" in sbResult ? sbResult.supabase : null;
    const eventStats = await fetchAnomalyEventStats(supabase);

    // Evaluate anomaly rules (S-BLE-18A + 18B)
    const anomalies = evaluateAnomalyRules(metrics, backendStatus, eventStats);

    // Count by severity
    const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
    const warningCount = anomalies.filter((a) => a.severity === "warning").length;

    return NextResponse.json({
      ok: true,
      anomalies,
      summary: {
        total: anomalies.length,
        critical: criticalCount,
        warning: warningCount,
      },
      metrics,
      backend_status: backendStatus,
      event_stats: eventStats.stats,
      event_stats_error: eventStats.error ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[anomalies] Error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to evaluate anomalies",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
