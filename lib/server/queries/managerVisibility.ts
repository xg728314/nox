import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type ManagerVisibilityResponse = {
  show_profit_to_owner: boolean
  show_hostess_profit_to_owner: boolean
}

export async function getManagerVisibility(auth: AuthContext): Promise<ManagerVisibilityResponse> {
  const supabase = getServiceClient()

  const { data: mgr } = await supabase
    .from("managers")
    .select("membership_id, show_profit_to_owner, show_hostess_profit_to_owner")
    .eq("membership_id", auth.membership_id)
    .eq("store_uuid", auth.store_uuid)
    .maybeSingle()

  return {
    show_profit_to_owner: mgr?.show_profit_to_owner ?? false,
    show_hostess_profit_to_owner: mgr?.show_hostess_profit_to_owner ?? false,
  }
}
