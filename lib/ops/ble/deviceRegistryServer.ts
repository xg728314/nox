import { createClient } from "@supabase/supabase-js"
import type { BleDeviceRegistryRow } from "./deviceRegistryTypes"
export async function loadBleDeviceRegistrySnapshot(storeUuid: string): Promise<BleDeviceRegistryRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []
  const supabase = createClient(url, key)
  const { data } = await supabase.from("ble_tags").select("id, minor, membership_id, tag_label, is_active").eq("store_uuid", storeUuid)
  return (data ?? []) as BleDeviceRegistryRow[]
}
export function clearBleDeviceRegistryCache() {}
export async function ensureBleAssignablePerson(_storeUuid: string, _membershipId: string): Promise<{ membership_id: string; name: string; role: string } | null> { return null }
