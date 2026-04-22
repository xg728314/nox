# CLEANUP AUDIT — FULL REPORT

_Generated: 2026-04-21T20:55:13.507Z_
_Generator: `npm run cleanup:audit` (scripts/cleanup-audit.mjs)_

## 1. Executive Summary

| Bucket | Count |
|---|---:|
| DISK_JUNK_ONLY | 30 |
| SAFE_DELETE_NOW | 0 |
| REVERIFY_BEFORE_DELETE | 1 |
| DO_NOT_DELETE | 2 |
| REFACTOR_LATER | 11 |
| MIGRATION_ANOMALY | 5 |
| DOC_SPRAWL | 17 |
| HIGH_RISK | 1 |

Tooling: Knip SKIPPED (--no-knip)

## 2. Disk Junk

- **.next_old_1776450826**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776458544**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776458655**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776462368**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776478812**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776479952**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776497596**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776502477**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776506515**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776508156**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776509557**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776513063**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776514887**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776517012**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776655401**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776656201**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776663549**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776664548**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776666969**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776672269**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776672993**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776673447**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776673818**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776700888**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776702580**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776703774**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776705898**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776707082**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776708385**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`
- **.next_old_1776709010**
  - Why: Next.js stale build artifact
  - Evidence: directory name matches /^.next_old_\d+$/
  - Confidence: high
  - Safety: rebuildable via `npm run build`

## 3. Safe Delete Now

_No findings._

## 4. Reverify Before Delete

- **lib/supabaseClient.ts**
  - Why: Only _ble_wip imports per grep; user flagged as suspect.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.

## 5. Do Not Delete

- **database/001_initial_schema.sql**
  - Why: Migration contains never-applied / deprecated marker
  - Evidence: file body matches /NEVER applied|DO NOT APPLY|deprecated/i
  - Confidence: medium
  - Safety: DO_NOT_DELETE — historical evidence referenced by BUGLOG.md / CLAUDE.md.
- **database/20260411_foxpro_checkout.sql**
  - Why: CLAUDE.md + BUGLOG.md document as NEVER applied; historical evidence.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Keep; deletion erases audit trail.

## 6. Refactor Later

- **lib/storeScopeInvariant.ts**
  - Why: No-op stub; only _ble_wip imports. Delete with _ble_wip.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/security/rateLimit.ts**
  - Why: 2-line stub; superseded by lib/security/clientIp.ts + rateLimitDurable.ts.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/security/safeAuthDebug.ts**
  - Why: Only _ble_wip imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/security/requireRole.ts**
  - Why: Only _ble_wip imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/automation/alertHooks.ts**
  - Why: Noop; only _ble_wip imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/debug/serverDebug.ts**
  - Why: Noop; only _ble_wip imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/config/featureFlags.ts**
  - Why: Empty Proxy; only _ble_wip imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/ops/**
  - Why: Only _ble_wip/api_ops_ble imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/mock/**
  - Why: Only _ble_wip/lib_ble imports.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **lib/counter/debug/**
  - Why: repeatSuppression.ts only referenced by _ble_wip/api_ops_ble/presence/route.ts.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.
- **_ble_wip/**
  - Why: 81-file archived subgraph; zero external imports. Tag+delete as one commit.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.

## 7. Migration Anomalies

- **database/010_fix_cross_store_fk.sql + database/010_session_participant_manager.sql**
  - Why: Duplicate migration number prefix 010
  - Evidence: multiple files share the "010_" prefix
  - Confidence: high
  - Safety: APPLIED migrations are immutable history. Rename requires DBA coordination — REFACTOR_LATER, not delete.
- **database/20260411_foxpro_checkout.sql, database/20260411_staff_attendance.sql, database/20260411_store_service_types.sql**
  - Why: Date-style migration file(s) coexist with numeric-prefix scheme
  - Evidence: filename matches /^\d{8}_/ while siblings use /^\d{3}_/
  - Confidence: medium
  - Safety: Review application status: if applied, keep; if never-applied, add `-- DO NOT APPLY` header and keep as historical record.
- **database/migrations/**
  - Why: Orphan migrations subfolder — parallel to flat database/*.sql scheme
  - Evidence: 1 file(s) present
  - Confidence: medium
  - Safety: Verify application status before consolidating; NEVER delete applied migrations.
- **database/010_fix_cross_store_fk.sql**
  - Why: Shares prefix 010 with 010_session_participant_manager.sql.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: REFACTOR_LATER with DBA; never delete applied migrations.
- **database/010_session_participant_manager.sql**
  - Why: Shares prefix 010 with 010_fix_cross_store_fk.sql.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: REFACTOR_LATER with DBA; never delete applied migrations.

## 8. Documentation Sprawl

- **1) step-next-owner-account-management-design-lock.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-001-role-expansion.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-final-hardening.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-floor5-10day-full-operation-simulation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-floor5-10day-heavy-operation-simulation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-owner-account-management-api-implementation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-owner-account-management-design-lock.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-owner-account-management-ui-implementation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-runtime-validation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-core-consolidation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-deep-validation-design-lock.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-formula-implementation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-formula-redefinition-lock.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-production-integration.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-relock-backfill.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-next-settlement-simulation-validation.md**
  - Why: Root-level markdown file outside the intentional doc set
  - Evidence: not in KEEP_ROOT_DOCS whitelist (8 entries)
  - Confidence: medium
  - Safety: Review and either (a) move to docs/ (which is locked — requires orchestration approval) or (b) delete if stale task note.
- **step-*.md (root)**
  - Why: 15 legacy orchestration step notes at repo root
  - Evidence: glob match on /^step-.*\.md$/
  - Confidence: high
  - Safety: Archive under orchestration/tasks/history/ rather than delete; preserves task audit trail.

## 9. High-Risk Wrong-Deletion Candidates

- **lib/supabaseClient.ts**
  - Why: Only _ble_wip imports per grep; user flagged as suspect.
  - Evidence: prior-round grep evidence
  - Confidence: high
  - Safety: Delete only together with _ble_wip/ in one atomic commit.

## 10. Recommended Execution Order

1. **Disk junk commit** — everything in section 2 (disk-only; rebuildable).
2. **Human review of section 4** — REVERIFY candidates need a build-plus-grep pass before deletion. Promote to SAFE_DELETE only after:
   - `npx tsc --noEmit` passes after stubbing the export
   - `npm run build` passes
   - Compiled `.next` chunks contain no mention of the symbol
3. **Archive _ble_wip/** — tag `ble-wip-archive`, then `git rm -rf _ble_wip/` + all section 6 files in one commit.
4. **Section 7 (migrations)** — separate round with DBA; never delete applied migrations.
5. **Section 8 (docs)** — move to `orchestration/tasks/history/` rather than delete.

---

_See CLEANUP_AUDIT_HOWTO.md for how to rerun this audit and how to extend it._
