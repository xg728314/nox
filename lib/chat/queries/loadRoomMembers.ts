import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolves membership_id → display name from managers + hostesses tables.
 *
 * Managers are looked up first; hostesses fill gaps. This matches the existing
 * priority used in rooms GET, messages GET, and participants GET.
 *
 * Returns a Map<membership_id, name>.
 */
export async function resolveMemberNames(
  supabase: SupabaseClient,
  store_uuid: string,
  membershipIds: string[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>()
  if (membershipIds.length === 0) return nameMap

  const { data: mgrNames } = await supabase
    .from("managers")
    .select("membership_id, name")
    .eq("store_uuid", store_uuid)
    .in("membership_id", membershipIds)
  for (const m of mgrNames ?? []) {
    nameMap.set(m.membership_id, m.name)
  }

  const { data: hstNames } = await supabase
    .from("hostesses")
    .select("membership_id, name")
    .eq("store_uuid", store_uuid)
    .in("membership_id", membershipIds)
  for (const h of hstNames ?? []) {
    if (!nameMap.has(h.membership_id)) {
      nameMap.set(h.membership_id, h.name)
    }
  }

  return nameMap
}

/**
 * Resolves membership_id → { name, role } for participant list display.
 *
 * Used by participants GET where role is needed alongside name.
 */
export async function resolveMemberNamesWithRole(
  supabase: SupabaseClient,
  store_uuid: string,
  membershipIds: string[]
): Promise<Map<string, { name: string; role: string }>> {
  const nameMap = new Map<string, { name: string; role: string }>()
  if (membershipIds.length === 0) return nameMap

  const { data: mgrs } = await supabase
    .from("managers")
    .select("membership_id, name")
    .eq("store_uuid", store_uuid)
    .in("membership_id", membershipIds)
  for (const m of (mgrs ?? []) as { membership_id: string; name: string }[]) {
    nameMap.set(m.membership_id, { name: m.name, role: "manager" })
  }

  const { data: hsts } = await supabase
    .from("hostesses")
    .select("membership_id, name")
    .eq("store_uuid", store_uuid)
    .in("membership_id", membershipIds)
  for (const h of (hsts ?? []) as { membership_id: string; name: string }[]) {
    if (!nameMap.has(h.membership_id)) {
      nameMap.set(h.membership_id, { name: h.name, role: "staff" })
    }
  }

  return nameMap
}
