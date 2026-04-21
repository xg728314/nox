/**
 * S-BLE-18B: BLE Security Alert Event Logger
 * Best-effort logging to ble_security_alert_events for pattern detection
 * Does not block alert flow if insert fails
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface BleAlertEventInput {
  alert_type: string;
  entity_type: "ip" | "gateway_id" | "room_id";
  entity_value: string;
  delivery_status: "suppressed" | "sent" | "emit_failed";
  detail?: Record<string, unknown>;
}

/**
 * Write BLE security alert event to DB for aggregation
 * Fail-soft: does not throw or reject on error
 * @param supabase - Supabase client (nullable)
 * @param input - Alert event data
 */
export async function writeBleAlertEvent(
  supabase: SupabaseClient | null,
  input: BleAlertEventInput
): Promise<void> {
  if (!supabase) {
    console.warn("[writeBleAlertEvent] No supabase client, skipping");
    return;
  }

  try {
    const { error } = await supabase
      .from("ble_security_alert_events")
      .insert({
        alert_type: input.alert_type,
        entity_type: input.entity_type,
        entity_value: input.entity_value,
        delivery_status: input.delivery_status,
        detail: input.detail ?? null,
      });

    if (error) {
      console.error("[writeBleAlertEvent] Insert failed (non-blocking):", error);
    }
  } catch (e) {
    console.error("[writeBleAlertEvent] Unexpected error (non-blocking):", e);
  }
}
