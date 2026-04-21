import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * STEP-013B: shared audit helpers.
 *
 * The `audit_events` table shape in 002_actual_schema.sql is:
 *   id, store_uuid, actor_profile_id (NOT NULL),
 *   actor_membership_id, actor_role (NOT NULL), actor_type,
 *   session_id, room_uuid, entity_table (NOT NULL), entity_id (NOT NULL),
 *   action (NOT NULL), before, after, reason, created_at
 *
 * There is no dedicated `status` or `metadata` column. We encode status
 * ('success' | 'denied' | 'failed') inside the `after` JSONB envelope and
 * encode the action verb in `action`. `entity_id` is NOT NULL, so callers
 * must always pass some id — for denied paths where no target is known,
 * fall back to the caller's store_uuid or auth.membership_id to satisfy
 * the constraint without inventing ids.
 *
 * Sensitive fields (tokens, full account numbers, OTP secrets, raw
 * credentials) must NEVER be placed in `metadata`. Callers are expected
 * to pre-sanitize. Helpers do not walk the object.
 *
 * All helpers are best-effort: failures are logged to console but never
 * thrown, so audit failures can never break the underlying financial
 * transaction (the call site has already committed before logging).
 */

export type AuditStatus = "success" | "denied" | "failed"

export type AuditEntityTable =
  | "settlements"
  | "settlement_items"
  | "payout_records"
  | "cross_store_settlements"
  | "cross_store_settlement_items"
  | "store_memberships"
  | "profiles"
  | "store_operating_days"

export type LogAuditInput = {
  auth: AuthContext
  action: string
  entity_table: AuditEntityTable
  entity_id: string
  status?: AuditStatus // default 'success'
  metadata?: Record<string, unknown>
  before?: Record<string, unknown> | null
  reason?: string | null
}

export type LogDeniedInput = {
  auth: AuthContext
  action: string
  entity_table: AuditEntityTable
  /** Target id if the request body supplied one; if absent the caller's
   * store_uuid is used to satisfy the NOT NULL constraint. */
  entity_id?: string | null
  reason: string
  metadata?: Record<string, unknown>
}

/**
 * Success / failure path logger. Use `status: 'failed'` for load-bearing
 * server exceptions that are not caused by caller authorization (e.g.
 * OVERPAY, SETTLEMENT_NOT_CONFIRMED) — those should still be traceable.
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  input: LogAuditInput
): Promise<void> {
  const status: AuditStatus = input.status ?? "success"
  const { error } = await supabase.from("audit_events").insert({
    store_uuid: input.auth.store_uuid,
    actor_profile_id: input.auth.user_id,
    actor_membership_id: input.auth.membership_id,
    actor_role: input.auth.role,
    actor_type: "user",
    entity_table: input.entity_table,
    entity_id: input.entity_id,
    action: input.action,
    before: input.before ?? null,
    after: {
      status,
      ...(input.metadata ?? {}),
    },
    reason: input.reason ?? null,
  })
  if (error) {
    console.warn(`[audit] ${input.action} (${status}) failed:`, error.message)
  }
}

/**
 * Denied path logger. For security / authorization rejections. Always
 * writes status='denied'. Entity id falls back to store_uuid so the row
 * is still attributable when no target was supplied.
 */
export async function logDeniedAudit(
  supabase: SupabaseClient,
  input: LogDeniedInput
): Promise<void> {
  const entityId = input.entity_id ?? input.auth.store_uuid
  const { error } = await supabase.from("audit_events").insert({
    store_uuid: input.auth.store_uuid,
    actor_profile_id: input.auth.user_id,
    actor_membership_id: input.auth.membership_id,
    actor_role: input.auth.role,
    actor_type: "user",
    entity_table: input.entity_table,
    entity_id: entityId,
    action: input.action,
    before: null,
    after: {
      status: "denied",
      ...(input.metadata ?? {}),
    },
    reason: input.reason,
  })
  if (error) {
    console.warn(`[audit] denied ${input.action} failed:`, error.message)
  }
}
