/**
 * S-BLE-13: DB-backed Threshold Implementation
 * Uses ble_threshold_events and ble_alert_suppressions for distributed tracking
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThresholdBackend } from "./thresholdBackend";

export class DbThresholdBackend implements ThresholdBackend {
  constructor(private supabase: SupabaseClient) {}

  async checkThreshold(key: string, windowMs: number, threshold: number): Promise<boolean> {
    try {
      const cutoff = new Date(Date.now() - windowMs).toISOString();

      const { error: insertErr } = await this.supabase
        .from("ble_threshold_events")
        .insert({ key, ts: new Date().toISOString() });

      if (insertErr) {
        console.warn("[dbThreshold] Insert failed:", insertErr.message);
        return false;
      }

      const { data, error: countErr } = await this.supabase
        .from("ble_threshold_events")
        .select("id", { count: "exact", head: true })
        .eq("key", key)
        .gte("ts", cutoff);

      if (countErr || typeof data !== "object" || data === null) {
        console.warn("[dbThreshold] Count failed:", countErr?.message);
        return false;
      }

      const count = (data as any).count ?? 0;
      return count >= threshold;
    } catch (e) {
      console.warn("[dbThreshold] checkThreshold error:", e);
      return false;
    }
  }

  async shouldSuppress(key: string, suppressMs: number): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("ble_alert_suppressions")
        .select("last_sent_at")
        .eq("key", key)
        .maybeSingle();

      if (error) {
        console.warn("[dbThreshold] Suppression check failed:", error.message);
        return false;
      }

      if (!data) return false;

      const lastSent = Date.parse(String((data as any).last_sent_at ?? ""));
      if (!Number.isFinite(lastSent)) return false;

      const elapsed = Date.now() - lastSent;
      return elapsed < suppressMs;
    } catch (e) {
      console.warn("[dbThreshold] shouldSuppress error:", e);
      return false;
    }
  }

  async markAlertSent(key: string, suppressMs: number): Promise<void> {
    try {
      const now = new Date().toISOString();
      const { error } = await this.supabase
        .from("ble_alert_suppressions")
        .upsert(
          { key, last_sent_at: now, updated_at: now },
          { onConflict: "key" }
        );

      if (error) {
        console.warn("[dbThreshold] Mark alert sent failed:", error.message);
      }
    } catch (e) {
      console.warn("[dbThreshold] markAlertSent error:", e);
    }
  }

  getBackendType() {
    return "db" as const;
  }
}
