import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type PayeeAccount = {
  id: string
  linked_membership_id: string | null
  payee_name: string | null
  role_type: string | null
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export type MePayeesResponse = { payees: PayeeAccount[] }

export async function getMePayees(auth: AuthContext): Promise<MePayeesResponse> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from("payee_accounts")
    .select("id, linked_membership_id, payee_name, role_type, bank_name, account_holder_name, account_number, is_active, note, created_at, updated_at")
    .eq("store_uuid", auth.store_uuid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return { payees: (data ?? []) as PayeeAccount[] }
}
