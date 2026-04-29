/**
 * Visualize layer — request guards and audit hook.
 *
 * Single entry point for every `app/api/super-admin/visualize/**` route.
 * Enforces:
 *   1. HTTP method = GET only (defence against accidental POST routing).
 *   2. resolveAuthContext → caller is approved super_admin (else 403).
 *   3. Writes a single `audit_events` row per request, encoded as
 *      action='visualize_*_read', entity_table='visualize'.
 *
 * The audit insert here is the ONLY write performed by visualize — it
 * exists for security observability (PII access tracking) and is
 * explicitly approved by the design (round Phase-1).
 *
 * Note on `entity_table`: the DB column is plain TEXT. The
 * `AuditEntityTable` union in `lib/audit/logEvent.ts` is a TS-only
 * narrowing that doesn't include 'visualize'. We intentionally bypass
 * that helper and write directly via the service client to avoid
 * touching `lib/audit/logEvent.ts` (project rule: no edits to existing
 * audit/auth modules).
 */

import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError, type AuthContext } from "@/lib/auth/resolveAuthContext"
import { getReadClient, type ReadClient } from "./readClient"

export type VisualizeGate =
  | { ok: true; auth: AuthContext; client: ReadClient }
  | { ok: false; response: NextResponse }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Run the standard visualize gate: GET-only + super_admin + read client.
 * Audit logging is a separate call (`writeVisualizeAudit`) so the route
 * can record the resolved scope (store_uuid, business_day_id, etc.) in
 * the audit row.
 */
export async function visualizeGate(request: Request): Promise<VisualizeGate> {
  if (request.method !== "GET") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "METHOD_NOT_ALLOWED", message: "Visualize routes accept GET only." },
        { status: 405, headers: { Allow: "GET" } },
      ),
    }
  }

  let auth: AuthContext
  try {
    auth = await resolveAuthContext(request)
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: err.type, message: err.message },
          { status: err.status },
        ),
      }
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Auth resolution failed." },
        { status: 500 },
      ),
    }
  }

  if (!auth.is_super_admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 },
      ),
    }
  }

  return { ok: true, auth, client: getReadClient() }
}

export function isUuid(s: string | null | undefined): s is string {
  return !!s && UUID_RE.test(s)
}

export type VisualizeAuditInput = {
  auth: AuthContext
  client: ReadClient
  /** e.g. 'visualize_money_read' */
  action: string
  /** Stable entity id for the audit row — use the primary scope identifier (business_day_id, session_id, store_uuid). */
  entity_id: string
  /** Free-form metadata (no PII). Stored under after.{...}. */
  metadata?: Record<string, unknown>
  /** Whether this read returned unmasked PII. Affects after.unmasked. */
  unmasked?: boolean
  /** The store_uuid the request actually read from (for cross-store visualize). */
  scope_store_uuid: string
}

/**
 * Best-effort audit row for a visualize read. Failures are logged to
 * console; visualize reads do not block on audit success because the
 * route is read-only and audit loss does not corrupt business state.
 *
 * Mirrors the column shape of `audit_events` (002_actual_schema.sql):
 *   store_uuid, actor_profile_id, actor_membership_id, actor_role,
 *   actor_type, entity_table, entity_id, action, before, after, reason.
 */
export async function writeVisualizeAudit(input: VisualizeAuditInput): Promise<void> {
  const { auth, client, action, entity_id, metadata, unmasked, scope_store_uuid } = input
  try {
    const supabase = client.rawForAudit()
    const { error } = await supabase.from("audit_events").insert({
      // The audit row is attributed to the scope being read, not the
      // caller's home store. This keeps cross-store reads attributable
      // to the correct store on per-store audit reports.
      store_uuid: scope_store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: "super_admin",
      entity_table: "visualize",
      entity_id,
      action,
      before: null,
      after: {
        status: "success",
        unmasked: !!unmasked,
        ...(metadata ?? {}),
      },
      reason: null,
    })
    if (error) {
      console.warn(`[visualize.audit] ${action} failed: ${error.message}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[visualize.audit] ${action} threw: ${msg}`)
  }
}
