/**
 * S-BLE-17: Alert System Status API
 * Runtime visibility into suppression behavior and backend health
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabaseOrError } from "@/lib/supabaseServer";
import { getRedisClient } from "@/lib/ble/security/redisClient";
import { alertMetrics } from "@/lib/ble/security/alertMetrics";

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
    try {
      const cookieStore = await cookies();
      const sbResult = getServerSupabaseOrError(cookieStore);
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

    // Get metrics snapshot
    const metrics = alertMetrics.getSnapshot();

    return NextResponse.json({
      backend_mode: backendMode,
      redis: {
        status: redisStatus,
        connected: redisConnected,
      },
      db: {
        status: dbStatus,
        connected: dbConnected,
      },
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[alert-system-status] Error:", e);
    return NextResponse.json(
      {
        error: "Failed to fetch alert system status",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
