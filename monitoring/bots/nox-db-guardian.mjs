#!/usr/bin/env node
/**
 * nox-db-guardian — P0.
 *
 * Read-only DB invariant checks. Uses the Supabase service-role key
 * (no per-bot read-only role exists today — see README) but only
 * issues SELECT via supabase-js `.select()`.
 *
 * Checks:
 *   1. Duplicate is_primary memberships per profile_id
 *        — the invariant migration 053 enforces at the index level;
 *          this check runs a redundant verify in case anyone dropped
 *          the index or bypassed it in a raw SQL session.
 *   2. auth_rate_limits table size / staleness
 *        — unbounded growth is a quiet DoS on the rate-limit path.
 *   3. Active lockouts (high count = attack in progress OR bug).
 *   4. Orphan memberships (profile_id or store_uuid not resolvable).
 *   5. Membership status drift (is_primary=true && status!='approved'
 *      on a non-soft-deleted row — a login-gate invariant).
 *
 * All checks are composed into a single alert per tick. Severity is
 * the max across checks. No check is allowed to issue a write.
 */

import { getReadOnlyClient } from "../shared/supabase.mjs"
import { thresholds } from "../shared/config.mjs"
import { severityFromThresholds, max } from "../shared/severity.mjs"
import { sendAlert } from "../shared/telegram.mjs"
import { log, logError } from "../shared/logger.mjs"

const BOT = "nox-db-guardian"
const DRY_RUN = process.argv.includes("--dry-run")

async function checkDuplicatePrimaries(sb) {
  // Fetch is_primary rows, count in-process. Keeps the query a plain
  // SELECT (no RPC dependency) and caps at 1000 active primaries per
  // round — any real NOX deployment is under 200.
  const { data, error } = await sb
    .from("store_memberships")
    .select("profile_id")
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(5000)
  if (error) throw new Error(`duplicate_primaries: ${error.message}`)
  const count = new Map()
  for (const r of data ?? []) count.set(r.profile_id, (count.get(r.profile_id) ?? 0) + 1)
  const dups = [...count.entries()].filter(([, n]) => n > 1)
  return {
    name: "duplicate_primary_membership",
    severity: dups.length === 0 ? "GREEN" : "RED",
    lines: dups.length === 0 ? [] : [`${dups.length} profile_id(s) with >1 is_primary=true row`,
      `top: ${dups.slice(0, 3).map(([id, n]) => `${id.slice(0, 8)}…=${n}`).join(", ")}`],
  }
}

async function checkAuthRateLimits(sb, t) {
  const { count, error } = await sb
    .from("auth_rate_limits")
    .select("key", { count: "exact", head: true })
  if (error) {
    return {
      name: "auth_rate_limits_size",
      severity: "ORANGE",
      lines: [`cannot count auth_rate_limits: ${error.message}`],
    }
  }
  const sev = severityFromThresholds(count ?? 0, {
    yellow: t.auth_rate_limits_stale_rows_yellow,
    orange: t.auth_rate_limits_stale_rows_orange,
  })
  return {
    name: "auth_rate_limits_size",
    severity: sev,
    lines: sev === "GREEN" ? [] : [`auth_rate_limits row count=${count}`],
  }
}

async function checkActiveLockouts(sb, t) {
  const nowIso = new Date().toISOString()
  const { count, error } = await sb
    .from("auth_rate_limits")
    .select("key", { count: "exact", head: true })
    .gt("locked_until", nowIso)
  if (error) {
    return { name: "active_lockouts", severity: "YELLOW", lines: [`query failed: ${error.message}`] }
  }
  const sev = severityFromThresholds(count ?? 0, {
    yellow: t.active_lockouts_yellow,
    orange: t.active_lockouts_orange,
    red:    t.active_lockouts_red,
  })
  return {
    name: "active_lockouts",
    severity: sev,
    lines: sev === "GREEN" ? [] : [`${count} keys currently locked out (locked_until > now)`],
  }
}

async function checkOrphanMemberships(sb) {
  // Orphan profile: join via .select() with !inner, invert by filtering nulls.
  // supabase-js cannot express "LEFT JOIN WHERE rhs IS NULL" directly, so we
  // fetch recent memberships and spot-check.
  const { data, error } = await sb
    .from("store_memberships")
    .select("id, profile_id, store_uuid")
    .is("deleted_at", null)
    .limit(2000)
  if (error) return { name: "orphan_memberships", severity: "YELLOW", lines: [`query failed: ${error.message}`] }

  const profileIds = [...new Set((data ?? []).map((r) => r.profile_id))]
  const storeIds   = [...new Set((data ?? []).map((r) => r.store_uuid))]

  const [{ data: profs }, { data: stores }] = await Promise.all([
    sb.from("profiles").select("id").in("id", profileIds).limit(profileIds.length || 1),
    sb.from("stores").select("id").in("id", storeIds).limit(storeIds.length || 1),
  ])
  const profSet  = new Set((profs  ?? []).map((p) => p.id))
  const storeSet = new Set((stores ?? []).map((s) => s.id))

  const orphanProf  = (data ?? []).filter((r) => !profSet.has(r.profile_id))
  const orphanStore = (data ?? []).filter((r) => !storeSet.has(r.store_uuid))

  const lines = []
  let sev = "GREEN"
  if (orphanProf.length > 0) { sev = "RED"; lines.push(`${orphanProf.length} membership(s) with unknown profile_id`) }
  if (orphanStore.length > 0) { sev = "RED"; lines.push(`${orphanStore.length} membership(s) with unknown store_uuid`) }
  return { name: "orphan_memberships", severity: sev, lines }
}

async function checkPrimaryStatusDrift(sb) {
  const { data, error } = await sb
    .from("store_memberships")
    .select("profile_id, status")
    .eq("is_primary", true)
    .is("deleted_at", null)
    .neq("status", "approved")
    .limit(50)
  if (error) return { name: "primary_status_drift", severity: "YELLOW", lines: [`query failed: ${error.message}`] }
  return {
    name: "primary_status_drift",
    severity: (data ?? []).length === 0 ? "GREEN" : "ORANGE",
    lines: (data ?? []).length === 0
      ? []
      : [`${data.length} is_primary=true rows with status != 'approved' (login-gate invariant)`],
  }
}

async function main() {
  const sb = getReadOnlyClient(BOT)   // exits(2) on missing env
  const t = thresholds().db_guardian

  log(BOT, "tick:start", {})

  const checks = []
  for (const fn of [
    () => checkDuplicatePrimaries(sb),
    () => checkAuthRateLimits(sb, t),
    () => checkActiveLockouts(sb, t),
    () => checkOrphanMemberships(sb),
    () => checkPrimaryStatusDrift(sb),
  ]) {
    try { checks.push(await fn()) }
    catch (e) {
      logError(BOT, "check:crash", e)
      checks.push({ name: fn.name, severity: "ORANGE", lines: [`check crashed: ${e.message}`] })
    }
  }

  let overall = "GREEN"
  for (const c of checks) overall = max(overall, c.severity)

  log(BOT, "tick:done", { overall, checks })

  if (overall === "GREEN") return   // quiet by design

  const evidence = checks
    .filter((c) => c.severity !== "GREEN")
    .flatMap((c) => [`[${c.name}] ${c.severity}`, ...c.lines.map((l) => `  ${l}`)])

  const failedNames = checks.filter((c) => c.severity !== "GREEN").map((c) => c.name).join(",")
  const summary = overall === "RED"
    ? "DB invariant violated — manual reconciliation required"
    : "DB guardian anomaly detected"
  const scope = `checks=[${failedNames}] tables=store_memberships,profiles,stores,auth_rate_limits`
  const action =
    overall === "RED"
      ? "Manual SQL reconciliation required; do not auto-heal. See BUGLOG.md for precedent."
      : overall === "ORANGE"
        ? "Operator review; correlate with security-watch auth anomalies"
        : "Monitor; elevate if anomaly persists across ticks"

  const alert = { bot: BOT, severity: overall, summary, scope, action, evidence }
  if (DRY_RUN) {
    console.log(JSON.stringify(alert, null, 2))
    return
  }
  await sendAlert(alert)
}

main().catch((e) => {
  logError(BOT, "fatal", e)
  process.exit(1)
})
