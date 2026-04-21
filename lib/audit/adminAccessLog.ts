import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-super-admin write action audit helper.
 *
 * Inserts into `admin_access_logs`. Failures are swallowed — audit is
 * observability, not a security gate, and the caller has already
 * executed the authoritative DB mutation by the time this runs.
 */
export async function logAdminAccess(
  supabase: SupabaseClient,
  args: {
    actor_user_id: string
    target_store_uuid: string
    screen: string
    action_kind: "read" | "write"
    action_detail: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await supabase.from("admin_access_logs").insert({
      actor_user_id: args.actor_user_id,
      actor_role: "super_admin",
      target_store_uuid: args.target_store_uuid,
      screen: args.screen,
      action_kind: args.action_kind,
      action_detail: args.action_detail,
      metadata: args.metadata ?? null,
    })
  } catch {
    /* swallow */
  }
}
