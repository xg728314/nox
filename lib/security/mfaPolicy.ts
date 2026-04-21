/**
 * STEP-013D: MFA + reauth policy matrix and reauth check helper.
 *
 * Centralizes the "when is MFA required" and "when is reauth required"
 * decisions so routes do not repeat policy inline. Default policy:
 *
 *   role      | MFA strongly recommended | financial write reauth
 *   owner     | true                      | required
 *   manager   | true                      | required
 *   hostess   | false (optional)          | N/A (can't write)
 *
 * The current rollout is conservative: MFA setup is available for all
 * roles, but existing users without MFA are not locked out. Once
 * business policy flips, `requiresMfa` can return true for a role and
 * the login route will refuse password-only sessions.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type Role = "owner" | "manager" | "hostess"
export type ActionClass = "financial_write" | "account_change"

export const REAUTH_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function requiresMfa(role: Role): boolean {
  // Soft-recommend for now. Flip to `role !== 'hostess'` to enforce.
  return false
}

export function requiresReauth(action: ActionClass, role: Role): boolean {
  if (role === "hostess") return false
  if (action === "financial_write") return true
  if (action === "account_change") return true
  return false
}

/**
 * Returns true if the user has a live reauth row for the given action
 * class. Used by financial write routes to short-circuit 401 before
 * touching the payout RPCs.
 */
export async function hasRecentReauth(
  supabase: SupabaseClient,
  userId: string,
  actionClass: ActionClass
): Promise<boolean> {
  const { data } = await supabase
    .from("reauth_verifications")
    .select("id")
    .eq("user_id", userId)
    .eq("action_class", actionClass)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
  return (data ?? []).length > 0
}
