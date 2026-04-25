import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type MyAccount = {
  id: string
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  account_type: string | null
  is_default: boolean
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export type MeAccountsResponse = { accounts: MyAccount[] }

export async function getMeAccounts(auth: AuthContext): Promise<MeAccountsResponse> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from("settlement_accounts")
    .select("id, bank_name, account_holder_name, account_number, account_type, is_default, is_active, note, created_at, updated_at")
    .eq("store_uuid", auth.store_uuid)
    .eq("owner_membership_id", auth.membership_id)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return { accounts: (data ?? []) as MyAccount[] }
}
