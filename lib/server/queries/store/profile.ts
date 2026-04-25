import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type StoreProfile = {
  store_uuid: string
  store_name: string
  created_at: string
  role: AuthContext["role"]
  membership_status: AuthContext["membership_status"]
}

export async function getStoreProfile(auth: AuthContext): Promise<StoreProfile> {
  const supabase = getServiceClient()

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, store_name, created_at")
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
  }
}
