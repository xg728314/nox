# NOX Monitoring — Multi-Bot Architecture

Five role-separated bots. Each does one job. None auto-remediates — bots
may *recommend* rollback but never execute it.

| Bot | Scope | Status | Audience |
|---|---|---|---|
| `nox-cutover-sentry` | Deployment / cutover window probes | **P0 — implemented** | operator |
| `nox-security-watch` | Auth anomaly detection from logs | **P0 — implemented** | operator |
| `nox-db-guardian` | DB invariant & security-state checks | **P0 — implemented** | operator + DBA |
| `nox-runtime-monitor` | Service runtime health (HTTP SLO) | P1 — scaffold | operator |
| `nox-cleanup-auditor` | Codebase hygiene drift | P2 — scaffold | developer |

Do NOT merge them. Each bot's alert logic must stay separated even
though they share sender / config / formatter utilities.

## Directory layout

```
monitoring/
├── README.md                         ← this file
├── config/
│   ├── thresholds.json               ← numeric limits per bot
│   ├── channels.json                 ← severity → Telegram chat routing
│   └── endpoints.json                ← probe URLs & expected contracts
├── shared/
│   ├── severity.mjs                  ← GREEN/BLUE/YELLOW/ORANGE/RED
│   ├── config.mjs                    ← env + JSON loader
│   ├── telegram.mjs                  ← HTTPS sender, severity-routed
│   ├── http.mjs                      ← probe wrapper with timing + retries
│   ├── supabase.mjs                  ← read-only service-role client
│   ├── logger.mjs                    ← one-line JSON structured logs
│   └── formatter.mjs                 ← Telegram markdown formatting
└── bots/
    ├── nox-cutover-sentry.mjs        ← P0
    ├── nox-security-watch.mjs        ← P0
    ├── nox-db-guardian.mjs           ← P0
    ├── nox-runtime-monitor.mjs       ← P1 scaffold
    └── nox-cleanup-auditor.mjs       ← P2 scaffold
```

## Severity model

| Level | Meaning | Default route |
|---|---|---|
| `GREEN` | All checks pass | (no alert, tick log only) |
| `BLUE` | Informational — smoke passed after deploy | operator |
| `YELLOW` | Degraded — worth watching | operator |
| `ORANGE` | Serious — operator should intervene | operator |
| `RED` | Critical — user-visible failure or security violation | operator **and** public |

Severity routing is declarative in `config/channels.json`. The Telegram
sender reads the route table; bot code only decides severity.

## Shared environment (required by all bots that use them)

| Var | Used by | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | all bots that alert | a single bot token; separation is by chat, not by token |
| `TELEGRAM_CHAT_PUBLIC` | RED routing | ops-facing public channel |
| `TELEGRAM_CHAT_OPS` | YELLOW/ORANGE/RED | on-call operator channel |
| `TELEGRAM_CHAT_DEV` | cleanup auditor | developer channel |
| `NOX_BASE_URL` | cutover-sentry, runtime-monitor | e.g. `https://nox.example.com` |
| `NOX_PROBE_*_EMAIL` / `_PASSWORD` | cutover-sentry | one per role: `OWNER`, `MANAGER`, `HOSTESS` |
| `NEXT_PUBLIC_SUPABASE_URL` | db-guardian | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | db-guardian | **read-only usage enforced by the bot — only SELECT is issued** |
| `NOX_SECURITY_LOG_PATH` | security-watch | path to a JSONL log stream or rolling file |

Missing env vars cause a bot to exit with status `2` and a single
`monitor:not_configured` log line — never a silent no-op.

## How to run

Each bot is a standalone Node ESM script. Invoke with `node`:

```bash
# P0
node monitoring/bots/nox-cutover-sentry.mjs
node monitoring/bots/nox-security-watch.mjs
node monitoring/bots/nox-db-guardian.mjs

# P1 / P2 (scaffolds — see files for status)
node monitoring/bots/nox-runtime-monitor.mjs
node monitoring/bots/nox-cleanup-auditor.mjs
```

Exit codes:

- `0` — ran, findings (if any) alerted, state is final (GREEN or alerted)
- `2` — misconfigured; a human must fix env/config before retrying
- `1` — bot internal error; see stderr; automatic retry is safe

## Scheduling (recommended)

Each bot is a **one-tick** script. Scheduling is external — pick ONE:

- **systemd timer** on the ops box (preferred for prod)
- **cron**:
  ```
  # cutover-sentry: every 60s during a cutover window
  * * * * *   node /opt/nox/monitoring/bots/nox-cutover-sentry.mjs
  # security-watch: every 2 min
  */2 * * * * node /opt/nox/monitoring/bots/nox-security-watch.mjs
  # db-guardian: every 5 min
  */5 * * * * node /opt/nox/monitoring/bots/nox-db-guardian.mjs
  ```
- **GitHub Actions** with `schedule`
- **PM2** with `cron_restart`

Do NOT run as a long-lived daemon. A one-tick-per-scheduler-event design
makes crashes self-heal and makes cadence explicit.

## Start / stop procedure

### Starting the fleet

1. Populate env vars on the ops host (use a systemd `EnvironmentFile=`).
2. Verify shared utilities by dry-running the cutover sentry in
   `--dry-run` mode (see the bot's header comment).
3. Install the scheduler entries (systemd / cron / PM2).
4. Confirm the first tick of each bot lands a `BLUE` start-notice in
   the ops channel.

### Stopping the fleet

1. Disable / remove the scheduler entries.
2. `kill` any in-flight ticks (safe — bots are idempotent).
3. Do NOT remove env vars until the next deploy — the fleet may be
   restarted during the same window.

### Emergency silence

Flip `TELEGRAM_BOT_TOKEN` to an empty string in the scheduler env. Bots
will log `monitor:not_configured` and exit `2` instead of paging.

## Unified alert format

Every bot emits the same 7-field block (rendered inside a Telegram
MarkdownV2 code fence so the layout is preserved):

```
bot:      nox-cutover-sentry
status:   🔴 RED
summary:  Cutover probe failures detected
scope:    roles=[owner,manager,hostess] base=https://nox.example.com
action:   ROLLBACK per CUTOVER_RUNBOOK.md §4 — do not promote this deploy
evidence:
  - owner: RED (login=4200ms)
  -   login failed status=503 reason=http elapsed=4200ms
  - manager: BLUE (login=420ms me=120ms logout=80ms)
  - hostess: BLUE (login=380ms me=95ms)
time:     2026-04-21T04:02:06.373Z
```

Field contract:

| Field | Required | Meaning |
|---|---|---|
| `bot` | yes | Bot name (one of the 5); identifies the source |
| `status` | yes | `<emoji> <SEVERITY>` from the severity model |
| `summary` | yes | One-line human-readable headline |
| `scope` | yes | What was inspected — route, table, window, log path, etc. |
| `action` | yes | What a human should do; `none — informational` when nothing |
| `evidence` | yes | Bulleted list of facts (timings, counts, correlations) |
| `time` | yes | ISO8601 UTC (auto-filled if omitted by the bot) |

Severity → channel routing (declared in `config/channels.json`):

| Severity | Default route | Cleanup auditor override |
|---|---|---|
| GREEN | (suppressed) | (suppressed) |
| BLUE | ops | dev |
| YELLOW | ops | dev |
| ORANGE | ops | dev |
| RED | **ops + public** | dev |

Routing guarantees:

- **RED** always reaches the public ops channel.
- **YELLOW / ORANGE / RED** always reach the operator channel.
- **cleanup-auditor** alerts **only** reach the developer channel, never ops or public.

### Other example payloads (per bot)

```
bot:      nox-security-watch
status:   🟠 ORANGE
summary:  Auth anomaly detected — 2 rule(s) over threshold
scope:    auth-log window=300s events=1847
action:   Operator triage — review top offenders in evidence
evidence:
  - MEMBERSHIP_AMBIGUOUS: 42 — invariant drift, see db-guardian
  - brute-force max/ip=28 — top: 203.0.113.7=28, 198.51.100.4=19
time:     2026-04-21T04:02:06.373Z
```

```
bot:      nox-db-guardian
status:   🔴 RED
summary:  DB invariant violated — manual reconciliation required
scope:    checks=[duplicate_primary_membership] tables=store_memberships,profiles,stores,auth_rate_limits
action:   Manual SQL reconciliation required; do not auto-heal. See BUGLOG.md for precedent.
evidence:
  - [duplicate_primary_membership] RED
  -   3 profile_id(s) with >1 is_primary=true row
  -   top: a1b2c3d4…=2, e5f6a7b8…=2, 9c8d7e6f…=2
time:     2026-04-21T04:02:06.373Z
```

```
bot:      nox-cleanup-auditor
status:   🔵 BLUE
summary:  Codebase drift detected since last audit
scope:    repo-wide cleanup audit (baseline=2026-04-20T18:00:00Z)
action:   Informational — review at developer convenience
evidence:
  - +2 REVERIFY candidate(s)
time:     2026-04-21T04:02:06.373Z
```

## Known integration prerequisites

- **Telegram**: one bot token, three chat IDs. No per-bot tokens — simpler rotation.
- **Supabase read-only**: db-guardian uses the service-role key but the bot emits only SELECT statements. We do NOT have a per-bot read-only role today (RLS is off for MVP); creating one is recommended future work.
- **Log access**: security-watch reads from a file path. On Vercel, pipe logs via `vercel logs --follow > /var/log/nox/auth.jsonl` or use the Drain feature to forward to a syslog / file. No Vercel API integration yet.
- **HTTP probes**: cutover-sentry needs reachable `NOX_BASE_URL` and valid test credentials per role. These accounts should be QA-only, not real users.
