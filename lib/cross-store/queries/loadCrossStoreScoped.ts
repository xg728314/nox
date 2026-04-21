import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolves store UUIDs to display names.
 *
 * Extracts the repeated stores lookup from route.ts GET, [id]/route.ts,
 * settlement/route.ts, records/route.ts.
 */
export async function resolveStoreNames(
  supabase: SupabaseClient,
  storeIds: string[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>()
  if (storeIds.length === 0) return nameMap

  const { data: stores } = await supabase
    .from("stores")
    .select("id, store_name")
    .in("id", storeIds)

  for (const s of (stores ?? []) as { id: string; store_name: string }[]) {
    nameMap.set(s.id, s.store_name)
  }

  return nameMap
}

/**
 * Resolves hostess membership_ids to display names.
 *
 * Extracts the repeated hostesses lookup from settlement/route.ts
 * and records/route.ts.
 */
export async function resolveHostessNames(
  supabase: SupabaseClient,
  store_uuid: string,
  membershipIds: string[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>()
  if (membershipIds.length === 0) return nameMap

  const { data: hostesses } = await supabase
    .from("hostesses")
    .select("membership_id, name")
    .eq("store_uuid", store_uuid)
    .in("membership_id", membershipIds)

  for (const h of (hostesses ?? []) as { membership_id: string; name: string }[]) {
    nameMap.set(h.membership_id, h.name)
  }

  return nameMap
}

/**
 * Resolves manager membership_ids to display names via
 * store_memberships → profiles join.
 *
 * Extracts the manager name resolution from [id]/route.ts.
 */
export async function resolveManagerNames(
  supabase: SupabaseClient,
  membershipIds: string[]
): Promise<Record<string, string>> {
  const nameById: Record<string, string> = {}
  if (membershipIds.length === 0) return nameById

  const { data: memRaw } = await supabase
    .from("store_memberships")
    .select("id, profile_id")
    .in("id", membershipIds)
  const mems = (memRaw ?? []) as Array<{ id: string; profile_id: string }>
  const pids = mems.map(m => m.profile_id)

  if (pids.length === 0) return nameById

  const { data: profRaw } = await supabase
    .from("profiles")
    .select("id, full_name, nickname")
    .in("id", pids)
  const profById: Record<string, { full_name: string | null; nickname: string | null }> = {}
  for (const p of (profRaw ?? []) as Array<{ id: string; full_name: string | null; nickname: string | null }>) {
    profById[p.id] = p
  }
  for (const m of mems) {
    const p = profById[m.profile_id]
    nameById[m.id] = p?.nickname || p?.full_name || m.id.slice(0, 8)
  }

  return nameById
}
