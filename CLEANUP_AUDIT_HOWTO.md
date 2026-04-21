# Cleanup Audit System — How to Run

This repo ships a permanent, reusable cleanup-detection system. It is
not a one-shot script — it is designed to be rerun every time we
suspect structural drift, before any big delete round, and (eventually)
in CI on a schedule.

## Quick start

```bash
npm install              # first time only — pulls knip as devDep
npm run cleanup:audit    # writes CLEANUP_AUDIT_FULL.md + .json
```

Optional flags (forward with `--`):

```bash
npm run cleanup:audit -- --no-knip   # skip the graph analyzer (offline / fast)
npm run cleanup:audit -- --json      # emit JSON to stdout instead of writing files
```

Exit codes: `0` = report written regardless of findings, `2` = tooling
failure (Knip crashed while enabled).

## What it produces

- `CLEANUP_AUDIT_FULL.md` — human-readable report, 10 sections:
  1. Executive Summary
  2. Disk Junk
  3. Safe Delete Now
  4. Reverify Before Delete
  5. Do Not Delete
  6. Refactor Later
  7. Migration Anomalies
  8. Documentation Sprawl
  9. High-Risk Wrong-Deletion Candidates
  10. Recommended Execution Order
- `CLEANUP_AUDIT_FULL.json` — machine-readable mirror for CI / scripts.

Every finding carries: **path**, **why**, **evidence**, **confidence**,
**safety note**.

## Architecture

```
npm run cleanup:audit
        │
        ▼
scripts/cleanup-audit.mjs
        │
        ├─── Knip (graph analyzer, via knip.json)
        │       • unused files
        │       • unused exports
        │       • unused dependencies
        │       • unresolved imports
        │
        ├─── scanDiskJunk()
        │       • .next_old_*
        │       • accidental literal path dirs (C:worknox*)
        │       • empty top-level dirs
        │
        ├─── scanMigrations()
        │       • duplicate NNN_ prefixes
        │       • date-style coexistence
        │       • orphan database/migrations/ subfolder
        │       • NEVER applied / DO NOT APPLY markers
        │
        ├─── scanDocSprawl()
        │       • root-level *.md outside KEEP_ROOT_DOCS
        │       • step-*.md orchestration overflow
        │
        ├─── explicitTargets()
        │       • user-supplied "must classify" list
        │
        ▼
classify()
        │  runtime-sensitive guard → DO_NOT_DELETE
        │  user-flagged suspect    → HIGH_RISK + REVERIFY
        │  everything else         → REVERIFY (default-conservative)
        ▼
render markdown + json
```

## Classification contract

A finding is only allowed into **SAFE_DELETE_NOW** if:

- zero static refs (Knip graph),
- zero re-export refs,
- zero dynamic/path-alias refs,
- zero config/script references,
- not in `RUNTIME_SENSITIVE_PREFIXES`,
- not in `USER_FLAGGED_SUSPECT`,
- and a candidate deletion set still passes:
  - `npx tsc --noEmit`
  - `npm run build`

In practice the audit script itself only assigns SAFE_DELETE to pure
disk junk. Code files land in **REVERIFY** even with zero static refs,
because dynamic imports, framework magic, and runtime-only reach can
all hide usage from static analysis. Promotion from REVERIFY →
SAFE_DELETE is a human decision and must be logged in the execution
commit message.

## Runtime-sensitive exclusion list

Defined in `scripts/cleanup-audit.mjs` as `RUNTIME_SENSITIVE_PREFIXES`.
Currently:

- `middleware.ts`
- `next.config.ts`
- `next-env.d.ts`
- `app/api/auth/`
- `app/api/ops/`
- `lib/auth/`
- `lib/security/`
- `lib/supabase*`
- `scripts/`
- `database/`

Anything matching one of these prefixes that Knip flags as unused is
re-bucketed to **DO_NOT_DELETE** on the grounds that static analysis
cannot see framework/runtime reach.

## User-flagged suspect list

`USER_FLAGGED_SUSPECT` in the script. Add a path here whenever a
reviewer says "I'm not sure this is dead, look twice." Entries are
force-routed to **REVERIFY + HIGH_RISK** regardless of graph evidence.

Current entries:

- `lib/supabaseClient.ts`

## How to extend

- **New disk-junk pattern:** edit `scanDiskJunk()` in
  `scripts/cleanup-audit.mjs`.
- **New migration rule:** edit `scanMigrations()`.
- **New doc-sprawl rule:** edit `scanDocSprawl()` or `KEEP_ROOT_DOCS`.
- **New Knip entry point** (e.g., a new tool folder): edit `knip.json`
  — add to `entry` AND `project`.
- **New runtime-sensitive path:** edit `RUNTIME_SENSITIVE_PREFIXES`.
- **New "always suspect" file:** edit `USER_FLAGGED_SUSPECT`.

## Future CI integration

Not wired up yet. When ready:

```yaml
# .github/workflows/cleanup-audit.yml (example)
name: cleanup-audit
on:
  schedule: [{ cron: "0 6 * * 1" }]   # Monday 06:00 UTC
  workflow_dispatch:
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npm run cleanup:audit
      - uses: actions/upload-artifact@v4
        with:
          name: cleanup-audit
          path: |
            CLEANUP_AUDIT_FULL.md
            CLEANUP_AUDIT_FULL.json
```

## Known limitations

- Knip may miss symbols consumed via string-based dynamic imports
  (`import(\`./routes/${name}\`)`). That is why REVERIFY is the default
  for all code findings.
- Windows-only: the accidental literal-path scan (`C:worknox*`) will
  be a no-op on POSIX checkouts. Harmless.
- The audit does not run `tsc` / `next build` itself — those are the
  human's gate before promoting anything to SAFE_DELETE.
