import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type StoreProfile = {
  store_uuid: string
  store_name: string
  created_at: string
  role: AuthContext["role"]
  membership_status: AuthContext["membership_status"]
  /** 2026-05-02 R-Cafe: 카페 owner UI 분기용. 3 = 카페. */
  floor: number | null
}

export async function getStoreProfile(auth: AuthContext): Promise<StoreProfile> {
  const supabase = getServiceClient()

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, store_name, created_at, floor")
    .eq("id", auth.store_uuid)
    .single()

  if (storeError || !store) {
    throw new Error("STORE_NOT_FOUND")
  }

  return {
    store_uuid: store.id,
    store_name: store.store_name,
    created_at: store.created_at,
    role: auth.role,
    membership_status: auth.membership_status,
    floor: typeof (store as { floor?: number }).floor === "number" ? (store as { floor: number }).floor : null,
  }
}
