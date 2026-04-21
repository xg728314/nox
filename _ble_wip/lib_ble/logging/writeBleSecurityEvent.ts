import type { SupabaseClient } from "@supabase/supabase-js";

export type WriteBleSecurityEventInput = {
  code: string;
  route: string;
  gateway_id?: string | null;
  store_uuid?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Write BLE security event to ble_security_events table.
 * S-BLE-8: Persist auth failures, rate limits, etc.
 * Does not throw; on error, fails silently.
 */
export async function writeBleSecurityEvent(
  supabase: SupabaseClient | null,
  input: WriteBleSecurityEventInput
): Promise<void> {
  if (!supabase) return;

  try {
    const row = {
      code: String(input.code ?? "").trim(),
      route: String(input.route ?? "").trim(),
      gateway_id: input.gateway_id && String(input.gateway_id).trim() !== "" ? String(input.gateway_id).trim() : null,
      store_uuid: input.store_uuid && String(input.store_uuid).trim() !== "" ? String(input.store_uuid).trim() : null,
      ip: input.ip && String(input.ip).trim() !== "" ? String(input.ip).trim() : null,
      user_agent: input.user_agent && String(input.user_agent).trim() !== "" ? String(input.user_agent).trim() : null,
      detail: input.detail && typeof input.detail === "object" ? input.detail : null,
    };

    await supabase.from("ble_security_events").insert(row);
  } catch {
    // Silent: never throw from logging
  }
}
