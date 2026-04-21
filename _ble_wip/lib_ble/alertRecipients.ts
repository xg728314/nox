/**
 * Resolve leave alert recipients: room manager, hostess self, girl manager.
 * Uses: active session for room (hostess_id match), ble_tags.person_id, affiliations table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type LeaveRecipients = {
  room_manager_profile_id: string | null;
  hostess_profile_id: string | null;
  girl_manager_profile_id: string | null;
};

/**
 * Find active session(s) for room where hostess_id matches the given profile id.
 * Returns session with manager_id, hostess_id; girl manager from affiliations.
 */
export async function resolveLeaveRecipients(
  supabase: SupabaseClient,
  params: {
    store_id: string;
    room_id: number | null;
    hostess_profile_id: string | null;
  }
): Promise<LeaveRecipients> {
  const { store_id, room_id, hostess_profile_id } = params;
  const out: LeaveRecipients = {
    room_manager_profile_id: null,
    hostess_profile_id: hostess_profile_id ?? null,
    girl_manager_profile_id: null,
  };

  if (!room_id) return out;

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, manager_id, hostess_id")
    .eq("room_id", room_id)
    .eq("status", "active")
    .limit(2);

  const session = Array.isArray(sessions) && sessions.length > 0
    ? sessions.find(
        (s: { hostess_id?: string | null }) =>
          s.hostess_id && hostess_profile_id && String(s.hostess_id) === String(hostess_profile_id)
      ) ?? sessions[0]
    : null;

  if (!session) return out;

  const managerId = (session as { manager_id?: string | null }).manager_id;
  const hostessId = (session as { hostess_id?: string | null }).hostess_id;
  if (managerId) out.room_manager_profile_id = String(managerId);
  if (hostessId && !out.hostess_profile_id) out.hostess_profile_id = String(hostessId);

  if (hostessId) {
    const { data: aff } = await supabase
      .from("affiliations")
      .select("manager_id")
      .eq("store_id", store_id)
      .eq("hostess_id", hostessId)
      .maybeSingle();
    if (aff && (aff as { manager_id?: string | null }).manager_id)
      out.girl_manager_profile_id = String((aff as { manager_id: string }).manager_id);
  }

  return out;
}
