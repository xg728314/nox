/**
 * Visualize Phase 2 — audit action → category mapping (prefix rules).
 *
 * Maps raw `audit_events.action` strings to a coarse category enum the
 * UI can filter by. Prefix-based on purpose: new actions added by future
 * rounds get auto-classified without code edits, as long as they follow
 * existing naming.
 *
 * Unmatched actions land in `other` (and a soft warning is surfaced by
 * the route so we notice drift).
 */

import type { NetworkAuditCategory, NetworkStatus } from "../shapes"

/**
 * Ordered prefix rules — first match wins.
 *
 * Note: ordering matters for prefixes that overlap. e.g.
 * `manager_settlement_*` falls under settlement, not access, even though
 * it also matches no `*_read` rule. Each test is `.startsWith()`.
 */
const PREFIX_RULES: ReadonlyArray<{
  category: NetworkAuditCategory
  prefixes: readonly string[]
}> = [
  {
    category: "settlement",
    prefixes: [
      "settlement_",
      "owner_settlement_",
      "manager_settlement_",
      "store_settlement_",
      "cross_store_settlement_",
      "closing_report_",
    ],
  },
  {
    category: "payout",
    prefixes: [
      "payout_",
      "pre_settlement_",
      "manager_prepayment_",
      "credit_",
    ],
  },
  {
    category: "participant",
    prefixes: [
      "participant_",
      "session_",
      "force_leave",
      "override_price",
      "force_close",
      "recover_session",
    ],
  },
  {
    category: "access",
    prefixes: [
      "visualize_",
      "admin_access_",
      "auth_",
      "login_",
      "logout_",
      "mfa_",
    ],
  },
]

/**
 * Suffix rules — applied after prefix miss. `*_read` lands in `access`.
 */
const SUFFIX_RULES: ReadonlyArray<{
  category: NetworkAuditCategory
  suffixes: readonly string[]
}> = [
  {
    category: "access",
    suffixes: ["_read", "_view", "_list"],
  },
]

/** True when the action verb suggests a destructive / risk move. */
const RISKY_TOKENS: readonly string[] = [
  "force",
  "override",
  "reject",
  "reverse",
  "cancel",
  "delete",
  "purge",
]

/**
 * Severity tokens for `classifyActionSeverity`. Order in the regex
 * matters only as documentation — actual matching uses any-substring.
 *
 * Per user instruction (P2.1d):
 *   - reject/reverse/cancel  → risk
 *   - force/override/edit/   → warning
 *     update/delete/purge
 *   - approve/confirm/       → normal
 *     finalize/commit
 *   - everything else        → normal (default)
 */
const RISK_RE = /(reject|reverse|cancel)/
const WARNING_RE = /(force|override|edit|update|delete|purge)/
const APPROVE_RE = /(approve|confirm|finalize|commit)/

/**
 * Classify a raw `audit_events.action` string into a NetworkAuditCategory.
 * Returns `'other'` when no rule matches.
 */
export function classifyAuditAction(action: string): NetworkAuditCategory {
  if (!action) return "other"
  const lower = action.toLowerCase()
  for (const rule of PREFIX_RULES) {
    for (const p of rule.prefixes) {
      if (lower.startsWith(p)) return rule.category
    }
  }
  for (const rule of SUFFIX_RULES) {
    for (const s of rule.suffixes) {
      if (lower.endsWith(s)) return rule.category
    }
  }
  return "other"
}

/** True when the action looks risky (used to mark audit nodes red). */
export function isRiskyAction(action: string): boolean {
  if (!action) return false
  const lower = action.toLowerCase()
  return RISKY_TOKENS.some((t) => lower.includes(t))
}

/**
 * Classify a raw `audit_events.action` into a NetworkStatus severity.
 *
 * Used by P2.1d to color audit nodes:
 *   - risk    → reject / reverse / cancel
 *   - warning → force / override / edit / update / delete / purge
 *   - normal  → approve / confirm / finalize / commit, or anything else
 *
 * NOTE: when an entity has multiple aggregated actions of mixed severity,
 * the caller takes the MAX (risk > warning > normal).
 */
export function classifyActionSeverity(action: string): NetworkStatus {
  if (!action) return "normal"
  const lower = action.toLowerCase()
  if (RISK_RE.test(lower)) return "risk"
  if (WARNING_RE.test(lower)) return "warning"
  // approve/confirm/finalize/commit collapse to 'normal' (no special tone)
  return "normal"
}

/** Numeric rank so callers can compute MAX severity. */
export function severityRank(status: NetworkStatus): number {
  if (status === "risk") return 2
  if (status === "warning") return 1
  return 0
}

/**
 * Classify the dominant verb of an action so the attach edge between an
 * entity and its audit node can pick the right edge type:
 *   - 'approved' → approve/confirm/finalize/commit         → approved_by
 *   - 'edited'   → everything else (incl. risky verbs)     → edited_by
 *
 * (We intentionally do NOT emit `rejected` / `reversed` / `cancelled_partial`
 * as audit attach edge types — those edge types are reserved for direct
 * payout-status edges in the money graph. Audit reversal severity is
 * conveyed via the audit node's status='risk', not the edge type.)
 */
export function classifyActionVerb(action: string): "approved" | "edited" {
  if (!action) return "edited"
  const lower = action.toLowerCase()
  if (APPROVE_RE.test(lower)) return "approved"
  return "edited"
}

/**
 * Parse a comma-separated `audit_categories` query param.
 * Returns the validated subset, dropping unknown tokens silently.
 * Empty/missing → returns the caller-supplied default.
 */
export function parseAuditCategories(
  raw: string | null | undefined,
  fallback: readonly NetworkAuditCategory[],
): NetworkAuditCategory[] {
  if (!raw || !raw.trim()) return Array.from(fallback)
  const parts = raw.split(",").map((s) => s.trim().toLowerCase())
  const valid: Set<NetworkAuditCategory> = new Set()
  for (const p of parts) {
    if (
      p === "settlement" ||
      p === "payout" ||
      p === "participant" ||
      p === "access" ||
      p === "other"
    ) {
      valid.add(p)
    }
  }
  return valid.size === 0 ? Array.from(fallback) : Array.from(valid)
}
