#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * NOX cleanup-audit system.
 *
 * Reads the repo, delegates code-graph analysis to Knip (JSON reporter),
 * layers on project-specific rules (disk junk, migration anomalies, doc
 * sprawl, runtime-sensitive guards), and emits CLEANUP_AUDIT_FULL.md
 * plus a machine-readable CLEANUP_AUDIT_FULL.json.
 *
 * This script does NOT delete anything. It only classifies.
 *
 * Usage:
 *   npm run cleanup:audit           # normal run, writes both reports
 *   npm run cleanup:audit -- --json # emit only JSON to stdout (CI)
 *   npm run cleanup:audit -- --no-knip  # skip Knip (offline / fast path)
 *
 * Exit codes:
 *   0  — audit ran, report written (regardless of findings)
 *   2  — audit tooling failure (Knip crashed + --no-knip not set)
 *
 * Classification buckets:
 *   SAFE_DELETE_NOW         — disk junk only; code must first be REVERIFY
 *   REVERIFY_BEFORE_DELETE  — evidence says dead, but runtime-sensitive OR
 *                             user-flagged; requires human sign-off
 *   DO_NOT_DELETE           — protected (auth, migrations, docs referenced
 *                             by BUGLOG, etc.)
 *   REFACTOR_LATER          — structural problem, not deletion
 *   DISK_JUNK_ONLY          — build artifacts, accidental literal paths
 *   MIGRATION_ANOMALY       — duplicate number, orphan folder, never-applied
 *   DOC_SPRAWL              — root-level markdown drift
 *
 * See CLEANUP_AUDIT_HOWTO.md for architecture, extension points, and the
 * promotion rules for moving a finding from REVERIFY → SAFE_DELETE.
 */

import { spawnSync } from "node:child_process"
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs"
import { join, relative, resolve, sep } from "node:path"

// ─── Config ────────────────────────────────────────────────────────
const ROOT = process.cwd()
const argv = new Set(process.argv.slice(2))
const FLAG_JSON_ONLY = argv.has("--json")
const FLAG_NO_KNIP = argv.has("--no-knip")

/**
 * Files and directory prefixes that must NEVER be auto-classified as
 * SAFE_DELETE regardless of what the static graph says. These have
 * runtime-only / framework-only / config-only reach that static
 * analysis cannot see.
 *
 * Matching is prefix-based against forward-slash paths.
 */
const RUNTIME_SENSITIVE_PREFIXES = [
  "middleware.ts",
  "next.config.ts",
  "next-env.d.ts",
  "app/api/auth/",
  "app/api/ops/",
  "lib/auth/",
  "lib/security/",
  "lib/supabase",
  "scripts/",
  "database/",
]

/**
 * Files the user has explicitly flagged as suspect in prior rounds.
 * Even with zero static refs, these must not be auto-deleted.
 * Add to this list when a reviewer calls out a risky candidate.
 */
const USER_FLAGGED_SUSPECT = new Set([
  "lib/supabaseClient.ts",
])

/**
 * Root-level markdown files that are part of the intentional doc set.
 * Any OTHER root-level *.md is flagged as DOC_SPRAWL.
 */
const KEEP_ROOT_DOCS = new Set([
  "CLAUDE.md",
  "CLEANUP_AUDIT.md",          // round 1
  "CLEANUP_AUDIT_FULL.md",     // round 2 output (this script)
  "CLEANUP_AUDIT_HOWTO.md",    // how to run the audit
  "CUTOVER_RUNBOOK.md",
  "DEPLOY_CHECKLIST.md",
  "SECURITY_HANDOFF.md",
  "NOX_SECURITY_KEY_MIGRATION_FINAL.md",
])

// ─── Utilities ──────────────────────────────────────────────────────
/** Normalize to forward-slash, repo-relative. */
function norm(p) {
  return relative(ROOT, p).split(sep).join("/")
}

function listDirSafe(p) {
  try {
    return readdirSync(p, { withFileTypes: true })
  } catch {
    return []
  }
}

function isEmptyDir(p) {
  return listDirSafe(p).length === 0
}

function walk(dir, out = [], skip = new Set()) {
  for (const d of listDirSafe(dir)) {
    if (skip.has(d.name)) continue
    const full = join(dir, d.name)
    if (d.isDirectory()) walk(full, out, skip)
    else out.push(full)
  }
  return out
}

function matchesPrefix(path, prefixes) {
  for (const p of prefixes) {
    if (path === p || path.startsWith(p)) return true
  }
  return false
}

// ─── 1. Disk junk scan ──────────────────────────────────────────────
function scanDiskJunk() {
  const hits = []
  const rootEntries = listDirSafe(ROOT)

  for (const d of rootEntries) {
    const name = d.name
    const full = join(ROOT, name)

    // Next.js stale build artifacts
    if (d.isDirectory() && /^\.next_old_\d+$/.test(name)) {
      hits.push({
        path: name,
        reason: "Next.js stale build artifact",
        evidence: "directory name matches /^.next_old_\\d+$/",
        confidence: "high",
        safety: "rebuildable via `npm run build`",
      })
      continue
    }

    // Accidental literal-path directories / files (created by bad
    // Windows path handling, e.g. `C:worknoxappapibleingest`).
    if (/^C:worknox/i.test(name)) {
      hits.push({
        path: name,
        reason: "Accidental literal-path artifact (Windows cd-path bug)",
        evidence: "filename starts with 'C:worknox'",
        confidence: "high",
        safety: "no references anywhere; pure filesystem junk",
      })
      continue
    }

    // Empty top-level directories that are not part of the framework
    // or explicit workspace boundaries.
    if (d.isDirectory() && !name.startsWith(".") && isEmptyDir(full)) {
      const allowEmpty = new Set([
        "public",
        "tests", // allowed to be empty pre-seed
      ])
      if (!allowEmpty.has(name)) {
        hits.push({
          path: name + "/",
          reason: "Empty top-level directory",
          evidence: "readdir returned 0 entries",
          confidence: "medium",
          safety: "may be a deliberate mount-point; verify before delete",
        })
      }
    }
  }

  return hits
}

// ─── 2. Migration anomaly scan ──────────────────────────────────────
function scanMigrations() {
  const anomalies = []
  const dbDir = join(ROOT, "database")
  const files = listDirSafe(dbDir)
    .filter((d) => d.isFile() && d.name.endsWith(".sql"))
    .map((d) => d.name)

  // Duplicate numeric prefix detection: `NNN_*.sql`.
  const byPrefix = new Map()
  for (const f of files) {
    const m = f.match(/^(\d{3})_/)
    if (!m) continue
    const key = m[1]
    const arr = byPrefix.get(key) ?? []
    arr.push(f)
    byPrefix.set(key, arr)
  }
  for (const [prefix, arr] of byPrefix) {
    if (arr.length > 1) {
      anomalies.push({
        path: arr.map((f) => `database/${f}`).join(" + "),
        reason: `Duplicate migration number prefix ${prefix}`,
        evidence: `multiple files share the "${prefix}_" prefix`,
        confidence: "high",
        safety: "APPLIED migrations are immutable history. Rename requires DBA coordination — REFACTOR_LATER, not delete.",
      })
    }
  }

  // Date-style migrations (20260411_*) without an integer ordinal.
  const dateStyle = files.filter((f) => /^\d{8}_/.test(f))
  if (dateStyle.length > 0) {
    anomalies.push({
      path: dateStyle.map((f) => `database/${f}`).join(", "),
      reason: "Date-style migration file(s) coexist with numeric-prefix scheme",
      evidence: "filename matches /^\\d{8}_/ while siblings use /^\\d{3}_/",
      confidence: "medium",
      safety: "Review application status: if applied, keep; if never-applied, add `-- DO NOT APPLY` header and keep as historical record.",
    })
  }

  // Orphan migrations/ subfolder.
  const sub = join(dbDir, "migrations")
  if (existsSync(sub)) {
    const subFiles = listDirSafe(sub).filter((d) => d.isFile())
    if (subFiles.length > 0) {
      anomalies.push({
        path: "database/migrations/",
        reason: "Orphan migrations subfolder — parallel to flat database/*.sql scheme",
        evidence: `${subFiles.length} file(s) present`,
        confidence: "medium",
        safety: "Verify application status before consolidating; NEVER delete applied migrations.",
      })
    }
  }

  // "NEVER applied" marker scan — content heuristic.
  for (const f of files) {
    const full = join(dbDir, f)
    let body = ""
    try { body = readFileSync(full, "utf8") } catch { continue }
    if (/NEVER applied|DO NOT APPLY|deprecated/i.test(body)) {
      anomalies.push({
        path: `database/${f}`,
        reason: "Migration contains never-applied / deprecated marker",
        evidence: "file body matches /NEVER applied|DO NOT APPLY|deprecated/i",
        confidence: "medium",
        safety: "DO_NOT_DELETE — historical evidence referenced by BUGLOG.md / CLAUDE.md.",
      })
    }
  }

  return anomalies
}

// ─── 3. Documentation sprawl scan ───────────────────────────────────
function scanDocSprawl() {
  const hits = []
  const rootEntries = listDirSafe(ROOT)
  for (const d of rootEntries) {
    if (!d.isFile()) continue
    const name = d.name
    if (!name.endsWith(".md")) continue
    if (KEEP_ROOT_DOCS.has(name)) continue
    hits.push({
      path: name,
      reason: "Root-level markdown file outside the intentional doc set",
      evidence: `not in KEEP_ROOT_DOCS whitelist (${KEEP_ROOT_DOCS.size} entries)`,
      confidence: "medium",
      safety: "Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.",
    })
  }

  // Legacy step-next-*.md files at root: count them; they are task
  // history sprawl from earlier orchestration rounds.
  const stepNextCount = rootEntries
    .filter((d) => d.isFile() && /^step-.*\.md$/i.test(d.name))
    .length
  if (stepNextCount > 3) {
    hits.push({
      path: "step-*.md (root)",
      reason: `${stepNextCount} legacy orchestration step notes at repo root`,
      evidence: "glob match on /^step-.*\\.md$/",
      confidence: "high",
      safety: "Archive under orchestration/tasks/history/ rather than delete; preserves task audit trail.",
    })
  }

  return hits
}

// ─── 4. Knip delegation ─────────────────────────────────────────────
function runKnip() {
  if (FLAG_NO_KNIP) return { skipped: true }
  // Use shell:true with a single string so Windows .cmd shims resolve
  // without the DEP0190 deprecation warning that fires when args are
  // passed alongside shell:true.
  const res = spawnSync(
    "npx --yes knip --reporter json --no-exit-code",
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true },
  )
  if (res.status !== 0 && !res.stdout) {
    return { error: res.stderr || res.error?.message || "knip failed" }
  }
  try {
    // Knip JSON reporter can emit a preamble on stderr; stdout is pure JSON.
    return { data: JSON.parse(res.stdout) }
  } catch (e) {
    return { error: `knip JSON parse: ${e.message}`, raw: res.stdout.slice(0, 500) }
  }
}

// ─── 5. Classifier ─────────────────────────────────────────────────
/**
 * Input: unified list of raw candidates from Knip + scans.
 * Output: classified buckets honoring validation-gate rules.
 */
function classify(candidates) {
  const buckets = {
    DISK_JUNK_ONLY: [],
    SAFE_DELETE_NOW: [],
    REVERIFY_BEFORE_DELETE: [],
    DO_NOT_DELETE: [],
    REFACTOR_LATER: [],
    MIGRATION_ANOMALY: [],
    DOC_SPRAWL: [],
    HIGH_RISK: [],
  }

  for (const c of candidates) {
    // Pre-classified tags short-circuit.
    if (c.bucket && buckets[c.bucket]) {
      buckets[c.bucket].push(c)
      if (c.bucket === "REVERIFY_BEFORE_DELETE" && USER_FLAGGED_SUSPECT.has(c.path)) {
        buckets.HIGH_RISK.push(c)
      }
      continue
    }

    // Knip-origin file-level candidate → default REVERIFY, with
    // runtime-sensitive guard promoting to DO_NOT_DELETE.
    if (c.source === "knip-unused-file") {
      if (matchesPrefix(c.path, RUNTIME_SENSITIVE_PREFIXES)) {
        buckets.DO_NOT_DELETE.push({
          ...c,
          reason: `${c.reason} — but path is in RUNTIME_SENSITIVE_PREFIXES`,
          safety: "Static graph cannot see framework/runtime reach; keep.",
        })
        continue
      }
      if (USER_FLAGGED_SUSPECT.has(c.path)) {
        const item = {
          ...c,
          safety: "User-flagged suspect; verify via build + chunk grep before deletion.",
        }
        buckets.REVERIFY_BEFORE_DELETE.push(item)
        buckets.HIGH_RISK.push(item)
        continue
      }
      buckets.REVERIFY_BEFORE_DELETE.push(c)
      continue
    }

    // Knip unused-export default → REVERIFY (may be consumed via dynamic import).
    if (c.source === "knip-unused-export" || c.source === "knip-unused-dep") {
      buckets.REVERIFY_BEFORE_DELETE.push(c)
      continue
    }

    // Fallback — unknown source, be conservative.
    buckets.REVERIFY_BEFORE_DELETE.push(c)
  }

  return buckets
}

// ─── 6. Knip result normalizer ─────────────────────────────────────
function knipToCandidates(knipData) {
  const out = []
  if (!knipData || !Array.isArray(knipData.issues)) return out

  for (const issue of knipData.issues) {
    const file = issue.file || issue.name || ""
    const relPath = file.startsWith(ROOT) ? norm(file) : file.split(sep).join("/")

    if (issue.files) {
      out.push({
        path: relPath,
        reason: "Knip: file has no inbound references",
        evidence: "knip --reporter json → issues[].files=true",
        confidence: "medium",
        source: "knip-unused-file",
      })
    }
    for (const exp of issue.exports ?? []) {
      out.push({
        path: `${relPath}:${exp.name ?? exp.symbol ?? "?"}`,
        reason: "Knip: exported symbol has no usage",
        evidence: "knip --reporter json → issues[].exports",
        confidence: "medium",
        source: "knip-unused-export",
      })
    }
    for (const dep of issue.dependencies ?? []) {
      out.push({
        path: `package.json:${dep.name ?? dep}`,
        reason: "Knip: dependency declared but not imported",
        evidence: "knip --reporter json → issues[].dependencies",
        confidence: "medium",
        source: "knip-unused-dep",
      })
    }
  }
  return out
}

// ─── 7. Explicit investigation targets ─────────────────────────────
/**
 * The user-supplied "must explicitly classify these" list. We check
 * existence and pre-assign a bucket based on prior-round evidence.
 * This anchors the report even when Knip is skipped.
 */
function explicitTargets() {
  const targets = [
    { path: "lib/supabaseClient.ts",          preBucket: "REVERIFY_BEFORE_DELETE",
      note: "Only _ble_wip imports per grep; user flagged as suspect." },
    { path: "lib/storeScopeInvariant.ts",     preBucket: "REFACTOR_LATER",
      note: "No-op stub; only _ble_wip imports. Delete with _ble_wip." },
    { path: "lib/security/rateLimit.ts",      preBucket: "REFACTOR_LATER",
      note: "2-line stub; superseded by lib/security/clientIp.ts + rateLimitDurable.ts." },
    { path: "lib/security/safeAuthDebug.ts",  preBucket: "REFACTOR_LATER",
      note: "Only _ble_wip imports." },
    { path: "lib/security/requireRole.ts",    preBucket: "REFACTOR_LATER",
      note: "Only _ble_wip imports." },
    { path: "lib/automation/alertHooks.ts",   preBucket: "REFACTOR_LATER",
      note: "Noop; only _ble_wip imports." },
    { path: "lib/debug/serverDebug.ts",       preBucket: "REFACTOR_LATER",
      note: "Noop; only _ble_wip imports." },
    { path: "lib/config/featureFlags.ts",     preBucket: "REFACTOR_LATER",
      note: "Empty Proxy; only _ble_wip imports." },
    { path: "lib/ops/",                       preBucket: "REFACTOR_LATER",
      note: "Only _ble_wip/api_ops_ble imports." },
    { path: "lib/mock/",                      preBucket: "REFACTOR_LATER",
      note: "Only _ble_wip/lib_ble imports." },
    { path: "lib/counter/debug/",             preBucket: "REFACTOR_LATER",
      note: "repeatSuppression.ts only referenced by _ble_wip/api_ops_ble/presence/route.ts." },
    { path: "_ble_wip/",                      preBucket: "REFACTOR_LATER",
      note: "81-file archived subgraph; zero external imports. Tag+delete as one commit." },
    { path: "database/010_fix_cross_store_fk.sql",        preBucket: "MIGRATION_ANOMALY",
      note: "Shares prefix 010 with 010_session_participant_manager.sql." },
    { path: "database/010_session_participant_manager.sql", preBucket: "MIGRATION_ANOMALY",
      note: "Shares prefix 010 with 010_fix_cross_store_fk.sql." },
    { path: "database/20260411_foxpro_checkout.sql",      preBucket: "DO_NOT_DELETE",
      note: "CLAUDE.md + BUGLOG.md document as NEVER applied; historical evidence." },
  ]

  const out = []
  for (const t of targets) {
    const exists = existsSync(join(ROOT, t.path))
    out.push({
      path: t.path,
      reason: exists ? t.note : "Explicit target NOT FOUND on disk",
      evidence: exists ? "prior-round grep evidence" : "existsSync=false",
      confidence: exists ? "high" : "n/a",
      bucket: exists ? t.preBucket : "SAFE_DELETE_NOW",
      source: "explicit-target",
      safety:
        t.preBucket === "DO_NOT_DELETE"
          ? "Keep; deletion erases audit trail."
          : t.preBucket === "MIGRATION_ANOMALY"
            ? "REFACTOR_LATER with DBA; never delete applied migrations."
            : "Delete only together with _ble_wip/ in one atomic commit.",
    })
  }
  return out
}

// ─── 8. Report writer ──────────────────────────────────────────────
function renderMarkdown(buckets, meta) {
  const now = new Date().toISOString()
  const count = (k) => buckets[k].length

  const section = (title, items) => {
    if (items.length === 0) return `## ${title}\n\n_No findings._\n\n`
    const rows = items
      .map(
        (i) =>
          `- **${i.path}**\n` +
          `  - Why: ${i.reason}\n` +
          `  - Evidence: ${i.evidence}\n` +
          `  - Confidence: ${i.confidence}\n` +
          `  - Safety: ${i.safety ?? "n/a"}`,
      )
      .join("\n")
    return `## ${title}\n\n${rows}\n\n`
  }

  return (
    `# CLEANUP AUDIT — FULL REPORT\n\n` +
    `_Generated: ${now}_\n` +
    `_Generator: \`npm run cleanup:audit\` (scripts/cleanup-audit.mjs)_\n\n` +
    `## 1. Executive Summary\n\n` +
    `| Bucket | Count |\n` +
    `|---|---:|\n` +
    `| DISK_JUNK_ONLY | ${count("DISK_JUNK_ONLY")} |\n` +
    `| SAFE_DELETE_NOW | ${count("SAFE_DELETE_NOW")} |\n` +
    `| REVERIFY_BEFORE_DELETE | ${count("REVERIFY_BEFORE_DELETE")} |\n` +
    `| DO_NOT_DELETE | ${count("DO_NOT_DELETE")} |\n` +
    `| REFACTOR_LATER | ${count("REFACTOR_LATER")} |\n` +
    `| MIGRATION_ANOMALY | ${count("MIGRATION_ANOMALY")} |\n` +
    `| DOC_SPRAWL | ${count("DOC_SPRAWL")} |\n` +
    `| HIGH_RISK | ${count("HIGH_RISK")} |\n\n` +
    `Tooling: ${meta.knip.skipped ? "Knip SKIPPED (--no-knip)" : meta.knip.error ? `Knip ERROR (${meta.knip.error})` : "Knip OK"}\n\n` +
    section("2. Disk Junk", buckets.DISK_JUNK_ONLY) +
    section("3. Safe Delete Now", buckets.SAFE_DELETE_NOW) +
    section("4. Reverify Before Delete", buckets.REVERIFY_BEFORE_DELETE) +
    section("5. Do Not Delete", buckets.DO_NOT_DELETE) +
    section("6. Refactor Later", buckets.REFACTOR_LATER) +
    section("7. Migration Anomalies", buckets.MIGRATION_ANOMALY) +
    section("8. Documentation Sprawl", buckets.DOC_SPRAWL) +
    section("9. High-Risk Wrong-Deletion Candidates", buckets.HIGH_RISK) +
    `## 10. Recommended Execution Order\n\n` +
    `1. **Disk junk commit** — everything in section 2 (disk-only; rebuildable).\n` +
    `2. **Human review of section 4** — REVERIFY candidates need a build-plus-grep pass before deletion. Promote to SAFE_DELETE only after:\n` +
    `   - \`npx tsc --noEmit\` passes after stubbing the export\n` +
    `   - \`npm run build\` passes\n` +
    `   - Compiled \`.next\` chunks contain no mention of the symbol\n` +
    `3. **Archive _ble_wip/** — tag \`ble-wip-archive\`, then \`git rm -rf _ble_wip/\` + all section 6 files in one commit.\n` +
    `4. **Section 7 (migrations)** — separate round with DBA; never delete applied migrations.\n` +
    `5. **Section 8 (docs)** — move to \`orchestration/tasks/history/\` rather than delete.\n\n` +
    `---\n\n` +
    `_See CLEANUP_AUDIT_HOWTO.md for how to rerun this audit and how to extend it._\n`
  )
}

// ─── Main ─────────────────────────────────────────────────────────
function main() {
  const diskJunk = scanDiskJunk().map((x) => ({
    ...x,
    source: "scan-disk-junk",
    bucket: "DISK_JUNK_ONLY",
  }))

  const migrations = scanMigrations().map((x) => {
    const preBucket =
      x.reason.includes("never-applied") || x.reason.includes("deprecated")
        ? "DO_NOT_DELETE"
        : "MIGRATION_ANOMALY"
    return { ...x, source: "scan-migrations", bucket: preBucket }
  })

  const docs = scanDocSprawl().map((x) => ({
    ...x,
    source: "scan-doc-sprawl",
    bucket: "DOC_SPRAWL",
  }))

  const knip = runKnip()
  const knipCandidates = knip.data ? knipToCandidates(knip.data) : []

  const explicit = explicitTargets()

  const buckets = classify([
    ...diskJunk,
    ...migrations,
    ...docs,
    ...knipCandidates,
    ...explicit,
  ])

  const meta = { knip, generatedAt: new Date().toISOString() }

  const md = renderMarkdown(buckets, meta)
  const json = JSON.stringify({ meta, buckets }, null, 2)

  if (FLAG_JSON_ONLY) {
    process.stdout.write(json)
    return
  }

  writeFileSync(join(ROOT, "CLEANUP_AUDIT_FULL.md"), md, "utf8")
  writeFileSync(join(ROOT, "CLEANUP_AUDIT_FULL.json"), json, "utf8")

  const totals = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.length]),
  )
  console.log("[cleanup-audit] wrote CLEANUP_AUDIT_FULL.md + .json")
  console.log("[cleanup-audit] totals:", totals)
  if (knip.error) {
    console.warn("[cleanup-audit] WARNING: Knip error —", knip.error)
    process.exit(2)
  }
}

main()
