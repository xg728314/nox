import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

type SessionAuditInput = {
  auth: AuthContext
  session_id: string
  room_uuid?: string
  entity_table: string
  entity_id: string
  action: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

/**
 * Writes a session-domain audit event.
 *
 * Best-effort: failures are logged but never thrown.
 * Extracts the repeated audit_events insert pattern from session routes.
 */
export async function writeSessionAudit(
  supabase: SupabaseClient,
  input: SessionAuditInput
): Promise<void> {
  const { error } = await supabase.from("audit_events").insert({
    store_uuid: input.auth.store_uuid,
    actor_profile_id: input.auth.user_id,
    actor_membership_id: input.auth.membership_id,
    actor_role: input.auth.role,
    actor_type: input.auth.role,
    session_id: input.session_id,
    room_uuid: input.room_uuid ?? null,
    entity_table: input.entity_table,
    entity_id: input.entity_id,
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
  })
  if (error) {
    console.warn(`[session-audit] ${input.action} failed:`, error.message)
  }
}
