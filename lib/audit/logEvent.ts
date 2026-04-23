import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * Shared audit helpers — **fail-close** for mutation paths (ROUND-A 보안 하드닝).
 *
 * `audit_events` table shape (002_actual_schema.sql):
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
 * ── Fail-close policy (post ROUND-A) ─────────────────────────────
 *   - `logAuditEvent` now **throws** `AuditWriteError` on insert failure.
 *     Previous "try/catch swallow" pattern 은 locked rule (CLAUDE.md
 *     L159) 위반이었다.
 *   - 호출 사이트는 `auditOr500(supabase, input)` 래퍼를 쓰면 에러 시
 *     NextResponse 500 (AUDIT_WRITE_FAILED) 을 자동 반환한다.
 *     route 의 기존 try/catch 구조를 바꾸지 않고도 fail-close 전환 가능.
 *   - `logDeniedAudit` 는 여전히 best-effort. 호출 컨텍스트가 이미
 *     401/403 를 반환하는 거부 경로이므로 audit 손실이 업무 mutation
 *     에 영향을 주지 않는다. 손실 시 console.warn.
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
  | "credits"

export type LogAuditInput = {
  auth: AuthContext
  action: string
  entity_table: AuditEntityTable
  entity_id: string
  status?: AuditStatus // default 'success'
  metadata?: Record<string, unknown>
  before?: Record<string, unknown> | null
  reason?: string | null
  /** Optional session context (audit_events.session_id NULLable column). */
  session_id?: string | null
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

export class AuditWriteError extends Error {
  constructor(public readonly action: string, message: string) {
    super(message)
    this.name = "AuditWriteError"
  }
}

/**
 * Mutation-path logger. **Throws `AuditWriteError` on failure.**
 *
 * Call sites that must return a structured 500 on audit failure should
 * use `auditOr500(supabase, input)` instead — it wraps this function.
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  input: LogAuditInput,
): Promise<void> {
  const status: AuditStatus = input.status ?? "success"
  const { error } = await supabase.from("audit_events").insert({
    store_uuid: input.auth.store_uuid,
    actor_profile_id: input.auth.user_id,
    actor_membership_id: input.auth.membership_id,
    actor_role: input.auth.role,
    actor_type: "user",
    session_id: input.session_id ?? null,
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
    // Fail-close: surface to caller. Previously: console.warn + swallow.
    console.error(`[audit] fail-close: ${input.action} (${status}) — ${error.message}`)
    throw new AuditWriteError(input.action, error.message)
  }
}

/**
 * Wrapper returning `NextResponse | null`.
 *   - null  → audit 성공, 정상 진행
 *   - NextResponse(500 AUDIT_WRITE_FAILED) → 호출 사이트가 그대로 return
 *
 * 사용 예:
 *   const auditFail = await auditOr500(supabase, { auth, action, entity_table, entity_id, metadata })
 *   if (auditFail) return auditFail
 *   return NextResponse.json({ ok: true, ... })
 */
export async function auditOr500(
  supabase: SupabaseClient,
  input: LogAuditInput,
): Promise<NextResponse | null> {
  try {
    await logAuditEvent(supabase, input)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        error: "AUDIT_WRITE_FAILED",
        message:
          "감사 로그 기록에 실패했습니다. 요청 상태가 일관되지 않을 수 있으니 운영자에게 즉시 보고하세요.",
        detail: msg,
        action: input.action,
      },
      { status: 500 },
    )
  }
}

/**
 * Denied path logger — remains **best-effort**. Denial responses (401/403)
 * are already emitted by the route; losing the audit row doesn't corrupt
 * business state. Failures are logged to console only.
 */
export async function logDeniedAudit(
  supabase: SupabaseClient,
  input: LogDeniedInput,
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
