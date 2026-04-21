import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError, type AuthContext } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  applySessionParticipantAction,
  type ApplyActionRow,
  type ApplyRow,
} from "@/lib/actions/applySessionParticipantAction"

/**
 * POST /api/ops/apply-recovery/stale-pending
 *
 * Recovery sweeper for stuck apply rows. Walks rows in
 * `public.session_participant_action_applies` whose `apply_status` is
 * still `'pending'` after the stale threshold and asks the shared
 * apply helper to retry them exactly once. Never creates new business
 * actions; never bypasses the apply-state pipeline; never duplicates
 * apply logic.
 *
 * Called either:
 *   - manually by owner / super-admin for ad-hoc rescue
 *   - by a scheduler / cron (no UI required; returns structured summary)
 *
 * ACCESS
 *   - role === "owner"            → operates on caller's own store
 *   - auth.is_super_admin === true → can pass `target_store_uuid` to
 *                                    sweep another store; otherwise
 *                                    defaults to caller's own store
 *   - header `x-cron-secret`       → if present AND matches the server
 *                                    `CRON_SECRET` env var, the request
 *                                    is treated as an automated cron
 *                                    invocation. `target_store_uuid` is
 *                                    REQUIRED in the body (no ambient
 *                                    caller store to infer from). Does
 *                                    NOT weaken existing auth access —
 *                                    it is an ADDITIVE allow path.
 *   - any other role / status      → 403
 *
 * POLICY (intentionally conservative)
 *   - STALE_THRESHOLD_MS = 5 min  (matches the client-side stale
 *     detection in `ApplyStatusBadge.isApplyStale` and the per-action
 *     /retry route's STALE_PENDING_MS)
 *   - AUTO_RETRY_MAX_ATTEMPTS = 1
 *       After the recovery bump the row is at `attempt_count = 2` and
 *       the next recovery run will no longer match the candidate
 *       filter. Failure leaves `apply_status='failed'` for a human to
 *       review via the per-action /retry endpoint. This keeps the
 *       auto-retry strictly bounded — no infinite retry loop is
 *       structurally possible.
 *   - DEFAULT_LIMIT = 20, MAX_LIMIT = 100
 *       Bounded execution per request. A cron can call repeatedly if
 *       a backlog exists; each call scans at most MAX_LIMIT rows.
 *
 * The route NEVER:
 *   - inserts a new `session_participant_actions` row
 *   - writes to settlement / BLE / session lifecycle tables
 *   - mutates participant state outside the shared helper's mutation
 */

const STALE_THRESHOLD_MS       = 5 * 60 * 1000
const AUTO_RETRY_MAX_ATTEMPTS  = 1
const DEFAULT_LIMIT            = 20
const MAX_LIMIT                = 100

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

type ApplyRowDB = {
  id: string
  action_id: string
  participant_id: string
  apply_status: "pending" | "success" | "failed"
  attempt_count: number
  last_attempted_at: string | null
}

type ActionRowDB = ApplyActionRow & {
  // No extra fields — ApplyActionRow covers the shared helper's needs.
}

type CandidateOutcome =
  | { kind: "success";         action_id: string; result: string }
  | { kind: "already_applied"; action_id: string }
  | { kind: "failed";          action_id: string; failure_code: string; failure_message: string }
  | { kind: "skipped";         action_id: string; reason: string }

export async function POST(request: Request) {
  try {
    // ── Access control ────────────────────────────────────────────
    // Two allowed paths, evaluated in order. Cron-secret is checked
    // FIRST so automated callers skip the auth cookie/bearer flow, but
    // it NEVER weakens the existing manual gate — any non-matching
    // header falls through to the standard resolveAuthContext path.
    const cronSecretHeader = request.headers.get("x-cron-secret")
    const cronSecretEnv    = process.env.CRON_SECRET

    // 🔽 디버그 로그 추가
    console.log("CRON_SECRET_ENV?", cronSecretEnv)
    console.log("CRON_HEADER?", cronSecretHeader)

    // Fail-closed on missing env: we only treat the header as valid
    // when BOTH values are present AND exactly equal. Missing env
    // never silently opens access.
    const cronAllowed =
      !!cronSecretEnv &&
      typeof cronSecretHeader === "string" &&
      cronSecretHeader.length > 0 &&
      cronSecretHeader === cronSecretEnv

    let auth: AuthContext
    let isOwner = false
    let isSuperAdmin = false
    let isCron = false

    if (cronAllowed) {
      // Synthetic auth for the cron path. `is_super_admin=true` so the
      // downstream target_store_uuid flow (originally super-admin
      // only) accepts the param. Membership / user fields are blanks;
      // audit writes are best-effort and will simply log a warning if
      // the FK refuses, which is acceptable for an automated sweep.
      auth = {
        user_id: "",
        membership_id: "",
        store_uuid: "",
        role: "owner",
        membership_status: "approved",
        global_roles: ["cron"],
        is_super_admin: true,
      }
      isCron = true
      isSuperAdmin = true
    } else {
      auth = await resolveAuthContext(request)
      // Role gate mirrors the "owner / super-admin / approved ops" spec.
      // waiter / staff / hostess / manager are all rejected here.
      isOwner      = auth.role === "owner"
      isSuperAdmin = auth.is_super_admin === true
      if (!isOwner && !isSuperAdmin) {
        return NextResponse.json(
          { error: "ROLE_FORBIDDEN", message: "Only owner or super-admin can run apply-recovery." },
          { status: 403 },
        )
      }
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const rawLimit = typeof body.limit === "number" ? body.limit : DEFAULT_LIMIT
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))

    // Super-admin / cron may target another store. Owners always sweep
    // their own store regardless of any `target_store_uuid` in the
    // body — we explicitly drop it so a confused owner request cannot
    // hop stores by accident. Cron requires the param because there
    // is no ambient caller store to infer from.
    let targetStoreUuid = auth.store_uuid
    if (isSuperAdmin && typeof body.target_store_uuid === "string" && body.target_store_uuid.length > 0) {
      const t = body.target_store_uuid.trim()
      if (!isValidUUID(t)) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "target_store_uuid must be a valid UUID." },
          { status: 400 },
        )
      }
      targetStoreUuid = t
    }
    if (isCron && !targetStoreUuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "target_store_uuid is required for cron invocation." },
        { status: 400 },
      )
    }

    const supabase = supa()
    const nowMs  = Date.now()
    const cutoffIso = new Date(nowMs - STALE_THRESHOLD_MS).toISOString()

    // ── Candidate selection ───────────────────────────────────────
    // Pull stale pending rows. attempt_count filter enforces the
    // auto-retry bound: after this run bumps to 2, a subsequent
    // recovery call will not re-select the row.
    //
    // We fetch 2× the limit to absorb potential store-scope filter
    // drop-offs (see join step below), but process at most `limit`.
    const fetchCap = Math.min(MAX_LIMIT * 2, limit * 2)
    const { data: applyRaw, error: applyErr } = await supabase
      .from("session_participant_action_applies")
      .select("id, action_id, participant_id, apply_status, attempt_count, last_attempted_at")
      .eq("apply_status", "pending")
      .lte("attempt_count", AUTO_RETRY_MAX_ATTEMPTS)
      .lt("last_attempted_at", cutoffIso)
      .order("last_attempted_at", { ascending: true })
      .limit(fetchCap)
    if (applyErr) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: applyErr.message },
        { status: 500 },
      )
    }
    const stale = (applyRaw ?? []) as ApplyRowDB[]
    const scanned = stale.length

    if (stale.length === 0) {
      return NextResponse.json(
        summaryOf({ scanned: 0, eligible: 0, target_store_uuid: targetStoreUuid, outcomes: [] }),
        { status: 200 },
      )
    }

    // Bulk-load the related action rows filtered to the target store.
    // This is the ONLY place store scope is enforced — the apply table
    // itself does not carry store_uuid, so we trust the parent action.
    const actionIds = Array.from(new Set(stale.map(a => a.action_id)))
    const { data: actRaw } = await supabase
      .from("session_participant_actions")
      .select("id, action_type, participant_id, session_id, store_uuid, effective_at, extension_count")
      .in("id", actionIds)
      .eq("store_uuid", targetStoreUuid)
    const actionById = new Map<string, ActionRowDB>()
    for (const r of (actRaw ?? []) as ActionRowDB[]) actionById.set(r.id, r)

    // Keep only candidates whose action is in the target store. Cap at
    // the request limit to bound processing time per call.
    const candidates: Array<{ apply: ApplyRowDB; action: ActionRowDB }> = []
    for (const a of stale) {
      const action = actionById.get(a.action_id)
      if (!action) continue // action missing or wrong store → skip (see NOTES)
      candidates.push({ apply: a, action })
      if (candidates.length >= limit) break
    }
    const eligible = candidates.length

    // ── Process each candidate through the shared helper ──────────
    const outcomes: CandidateOutcome[] = []
    let attempted = 0, success = 0, failed = 0, already_applied = 0, skipped = 0

    // Build a scoped auth for the helper. For super-admin sweeping a
    // foreign store we must substitute `store_uuid` so the helper's
    // store-scope validation passes; membership_id is kept as the
    // super-admin's own id for audit traceability.
    const scopedAuth: AuthContext = targetStoreUuid === auth.store_uuid
      ? auth
      : { ...auth, store_uuid: targetStoreUuid }

    for (const { apply, action } of candidates) {
      // Defensive: if somehow an action-missing row slipped in (e.g.,
      // FK was weakened), mark as skipped rather than crashing the run.
      if (!action) {
        skipped++
        outcomes.push({ kind: "skipped", action_id: apply.action_id, reason: "action_missing" })
        continue
      }

      // Pre-increment: bump attempt_count + touch last_attempted_at
      // BEFORE the helper call. This ensures that even if the helper
      // throws, the next sweep will no longer match this row (because
      // attempt_count rises above AUTO_RETRY_MAX_ATTEMPTS). Mirrors
      // the per-action /retry route's pattern.
      const nowIso = new Date().toISOString()
      const nextAttempt = apply.attempt_count + 1
      const { error: upErr } = await supabase
        .from("session_participant_action_applies")
        .update({
          attempt_count: nextAttempt,
          last_attempted_at: nowIso,
          // Reset previous failure fields — the helper will overwrite
          // success fields on success, or re-populate failure_* on
          // failure, so blanking now keeps the row coherent.
          failure_code: null,
          failure_message: null,
          updated_at: nowIso,
        })
        .eq("id", apply.id)
      if (upErr) {
        skipped++
        outcomes.push({ kind: "skipped", action_id: action.id, reason: `preupdate_failed:${upErr.message}` })
        continue
      }

      attempted++
      const existingApply: ApplyRow = {
        id: apply.id,
        apply_status: "pending",
        attempt_count: nextAttempt,
      }

      const outcome = await applySessionParticipantAction({
        supabase,
        auth: scopedAuth,
        action,
        existingApply,
      })

      if (outcome.ok && outcome.already_applied) {
        already_applied++
        outcomes.push({ kind: "already_applied", action_id: action.id })
      } else if (outcome.ok) {
        success++
        outcomes.push({ kind: "success", action_id: action.id, result: outcome.result })
      } else {
        failed++
        outcomes.push({
          kind: "failed",
          action_id: action.id,
          failure_code: outcome.code,
          failure_message: outcome.message,
        })
      }
    }

    return NextResponse.json(
      summaryOf({
        scanned,
        eligible,
        target_store_uuid: targetStoreUuid,
        outcomes,
        attempted,
        success,
        failed,
        already_applied,
        skipped,
      }),
      { status: 200 },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    )
  }
}

function summaryOf(input: {
  scanned: number
  eligible: number
  target_store_uuid: string
  outcomes: CandidateOutcome[]
  attempted?: number
  success?: number
  failed?: number
  already_applied?: number
  skipped?: number
}) {
  return {
    ok: true,
    target_store_uuid: input.target_store_uuid,
    threshold_ms: STALE_THRESHOLD_MS,
    limit_config: { default: DEFAULT_LIMIT, max: MAX_LIMIT },
    auto_retry_max_attempts: AUTO_RETRY_MAX_ATTEMPTS,
    summary: {
      scanned: input.scanned,
      eligible: input.eligible,
      attempted: input.attempted ?? 0,
      success: input.success ?? 0,
      failed: input.failed ?? 0,
      already_applied: input.already_applied ?? 0,
      skipped: input.skipped ?? 0,
    },
    outcomes: input.outcomes,
  }
}