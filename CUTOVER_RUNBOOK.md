# NOX — Production Cutover Runbook

**Audience:** operators executing the first production deploy after the R-1 → R-7 security round.

**Use:** read top-to-bottom. Each step has an owner tag (OP / DBA / QA). Do not skip ahead.

**Cutover budget:** ~60 minutes end-to-end (excluding migration duration on huge tables — for this project the two new migrations are small).

**Prerequisite:** staging environment has already run through this exact runbook with all smoke tests green. This runbook is for promoting to production.

---

## 1. CUTOVER ORDER (single page)

```
T-60m  OP   Pre-flight freeze + announcements
T-55m  OP   Env var audit on production host
T-45m  OP   Rotate Supabase service_role key (if not already)
T-40m  OP   GitHub secret-scanning triage
T-30m  DBA  Pre-migration data health check
T-25m  DBA  Apply migration 052 (auth_rate_limits)
T-20m  DBA  Apply migration 053 (is_primary unique index)
T-15m  OP   Trigger production deploy (new build)
T-10m  OP   Pre-cutover smoke set (A-series) against preview URL
T-05m  OP   DNS / routing cutover to new build
T+00m  QA   Full smoke test battery (A / M / F / R / B)
T+15m  QA   Sign-off OR trigger rollback
T+20m  OP   Announce success OR post-mortem start
```

---

## 2. OPERATOR TASKS

### 2.1 Pre-flight freeze (T-60m)
- [ ] Confirm no outstanding deploys / hotfixes in flight on the target environment
- [ ] Notify team: "NOX production cutover in progress, expect 10-minute blip at T+00m"
- [ ] Open this runbook + `DEPLOY_CHECKLIST.md` + `SECURITY_HANDOFF.md` in tabs
- [ ] Have the Supabase dashboard for the production project open
- [ ] Have the deploy platform console open (Vercel / Netlify / your infra)

### 2.2 Environment variable audit (T-55m)
On the **production** host, confirm these 8 variables are set. Values come from your secrets manager — never from this runbook.

| Variable | Where to check |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel project env / `.env.production` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same. Must be new-format `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same. Must be the **post-rotation** key (see 2.3) |
| `MFA_SECRET_KEY` | Same. 32-byte base64 |
| `DEVICE_HASH_SECRET` | Same |
| `AUTH_SECRET` | Same |
| `NEXTAUTH_SECRET` | Same |
| `CRON_SECRET` | Same |

Conditional:
- [ ] `TRUSTED_PROXY` — set to `"true"` **only** if deployed behind a self-hosted reverse proxy that strips client-supplied `X-Forwarded-For`. Do NOT set on Vercel / Cloudflare.

Verify no leftover keys:
- [ ] `grep eyJhbGci <production-env-dump>` → 0 hits (both URL and SERVICE_ROLE)

### 2.3 Legacy key rotation (T-45m)
**If the rotation already happened in a previous round, jump to 2.4 after verifying step 1 below.**

- [ ] Supabase dashboard → Settings → API → `service_role` key → confirm the status is **revoked** (not merely "rotated") for the legacy `eyJhbGci...` key
- [ ] Write down the new key's first 8 chars (`sb_secret_Xxxx...`) in your private ops log
- [ ] Update `SUPABASE_SERVICE_ROLE_KEY` in the production env to the new value
- [ ] If production MCP / analytics tooling also uses this key, update all those clients in the same window

### 2.4 GitHub secret-scanning triage (T-40m)
- [ ] Visit the repo's Security → Secret scanning alerts page
- [ ] Any `eyJhbGci...` / Supabase service-role alerts → mark as "Revoked" with comment "Rotated per R-1 round cutover"
- [ ] If alerts show external notifications (e.g., sent to `security@supabase.io`), confirm the key is indeed dead on Supabase side — otherwise the report is valid and the rotation above is not actually done

### 2.5 Deploy trigger (T-15m)
- [ ] On deploy platform → trigger a build from the tagged commit that contains the security round changes
- [ ] Wait for build to finish with `tsc --noEmit` = 0 errors, `npm run build` = success
- [ ] Do NOT promote to production yet — stay on preview URL for step 2.6

### 2.6 Preview smoke (T-10m)
Run smoke subset **A1 / A2 / A3 / A4 / A5 / A6** (see §5) against the preview URL.
- [ ] All 6 pass → proceed to 2.7
- [ ] Any fails → STOP. Do not cutover. Invoke §6 Rollback or debug without impact to production.

### 2.7 Cutover (T-05m → T+00m)
- [ ] Promote new build to production (DNS swap / alias flip / platform promote)
- [ ] Confirm production URL returns the new build (check `<meta name="build-id">` or equivalent if present; otherwise check a dev-only marker)
- [ ] Start clock for QA

### 2.8 Post-cutover announcement (T+20m)
After QA signs off (§4):
- [ ] Announce success to the team
- [ ] Archive this runbook with date + commit SHA
- [ ] Kick off `SECURITY_HANDOFF.md` §2 follow-ups on the backlog

---

## 3. DBA TASKS

### 3.1 Pre-migration data health check (T-30m)
Run on **production** DB, read-only:

```sql
-- Check 1: duplicate primary memberships (must be 0 rows)
SELECT profile_id, COUNT(*) AS c
FROM public.store_memberships
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY profile_id
HAVING COUNT(*) > 1;

-- Check 2: legacy eyJhbGci references anywhere in DB metadata
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) LIKE '%eyJhbGci%';
-- expected: 0 rows

-- Check 3: auth_rate_limits pre-existence (migration 052 uses IF NOT EXISTS,
-- but confirm there is no conflicting schema)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'auth_rate_limits';
-- expected: either 0 rows (fresh install) OR the exact columns defined in 052
```

- [ ] Check 1 returns 0 rows. **If not**, resolve the duplicate primaries first — migration 053 will refuse to apply otherwise. Ask the operator to pause and call for data triage.
- [ ] Check 2 returns 0 rows
- [ ] Check 3 returns 0 rows (fresh) or matches `database/052_auth_rate_limits.sql` column list (previously applied via MCP)

### 3.2 Apply migration 052 (T-25m)
```bash
# Adjust connection command to your environment
psql $DATABASE_URL -v ON_ERROR_STOP=1 -f database/052_auth_rate_limits.sql
```

- [ ] No errors printed
- [ ] Post-apply verification:
  ```sql
  \d public.auth_rate_limits                 -- table exists with 8 columns
  \df public.auth_rl_tick_attempt            -- RPC exists
  \df public.auth_rl_record_failure          -- RPC exists
  \df public.auth_rl_clear                   -- RPC exists
  ```

### 3.3 Apply migration 053 (T-20m)
```bash
psql $DATABASE_URL -v ON_ERROR_STOP=1 -f database/053_store_memberships_primary_unique.sql
```

- [ ] The embedded `DO` block prints no `RAISE EXCEPTION`
- [ ] Post-apply verification:
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename = 'store_memberships'
    AND indexname = 'ux_store_memberships_one_primary_per_profile';
  -- expected: 1 row, partial index WHERE (is_primary = true AND deleted_at IS NULL)
  ```

### 3.4 Hand off to operator (T-18m)
- [ ] Ping the operator: "DB migrations done, safe to deploy"
- [ ] Keep DB access open in case §4 QA needs a M3 check (intentional duplicate-primary INSERT on a throwaway test account)

---

## 4. QA TASKS

### 4.1 Setup (T-01m)
- [ ] Have 3 browsers / incognito sessions open for multi-role testing
- [ ] Have the test accounts ready (at least one owner, one manager, one hostess with known passwords)
- [ ] Have `curl` + `jq` available on your workstation
- [ ] Have this runbook's §5 (Smoke Test Order) visible

### 4.2 Run smoke tests in the order §5 defines (T+00m → T+15m)
- [ ] All tests pass → sign off in §4.3
- [ ] Any test fails → DO NOT continue. Report the failure to the operator. Invoke §6 Rollback.

### 4.3 Sign-off (T+15m)
Fill in:
```
Build SHA: _________________
Cutover time (UTC): _________
Tests passed: [A1][A2][A3][A4][A5][A6][M1][M2][F1][F2][F3][R1][R2][B1][B2]
QA signoff by: _________________
```
Post this block to the team channel.

---

## 5. SMOKE TEST ORDER (execute top-to-bottom)

Each test has a **fail rule**: if the actual behavior differs, stop and report. Do not cascade.

### Phase 1 — Auth transport (A-series) · 4 min

**A1. Rate-limit on bad password**
```
Repeat 11×:
  curl -X POST https://<prod>/api/auth/login \
       -H "Content-Type: application/json" \
       -d '{"email":"test@example.com","password":"wrong","device_id":"qa-probe-A1"}'
```
- PASS: 1st-10th return 401. 11th returns **429 RATE_LIMITED** with `Retry-After` header.
- FAIL: 11th still returns 401 → durable rate-limit not working → check migration 052 applied.

**A2. Cookie flag verification**
Using a real test account, login. Inspect response headers.
- PASS: `Set-Cookie: nox_access_token=…; HttpOnly; SameSite=Lax; Secure; Path=/`
- FAIL: missing `HttpOnly` → deploy picked up wrong code.

**A3. XSS-style token leak check**
In the browser console on an authenticated page:
```js
document.cookie
```
- PASS: string does NOT contain `nox_access_token=`
- FAIL: token visible → HttpOnly flag not set on cookie.

**A4. localStorage purge**
```js
localStorage.getItem("access_token")
localStorage.getItem("role")
localStorage.getItem("store_uuid")
```
- PASS: all three return `null`
- FAIL: any value present → client didn't cleanup or old code still writing.

**A5. Logout closes session**
```
curl -X POST https://<prod>/api/auth/logout -b cookie.txt -c cookie.txt
curl https://<prod>/api/auth/me -b cookie.txt
```
- PASS: /me returns 401
- FAIL: /me returns 200 with data → cookie wasn't cleared.

**A6. No Bearer-null request succeeds**
```
curl https://<prod>/api/auth/me -H "Authorization: Bearer null"
```
- PASS: 401
- FAIL: 200 → `resolveAuthContext` regressed.

### Phase 2 — Membership consistency (M-series) · 3 min

**M1. Single primary approved membership**
Login as a known healthy test account.
- PASS: 200, response contains correct `role` and `store_uuid` for the intended store
- FAIL: wrong store or 500 → migration 053 or R-6 code regressed.

**M2. No approved membership**
Login as an account whose only membership is `status='pending'`.
- PASS: 401 `MEMBERSHIP_NOT_APPROVED`
- FAIL: 200 / 500 / other → check resolveAuthContext.

**M3. (DBA-gated) Duplicate primary INSERT**
DBA runs:
```sql
INSERT INTO public.store_memberships (profile_id, store_uuid, role, status, is_primary)
VALUES ('<any-existing-profile-with-primary>', '<any-other-store>', 'manager', 'approved', true);
```
- PASS: INSERT fails with `duplicate key value violates unique constraint "ux_store_memberships_one_primary_per_profile"`
- FAIL: INSERT succeeds → migration 053 not applied.

### Phase 3 — Filter injection (F-series) · 2 min

**F1. Comma injection rejected**
```
curl 'https://<prod>/api/audit-events?q=foo,actor_profile_id.eq.00000000-0000-0000-0000-000000000000' \
     -b cookie.txt  # authenticated owner session
```
- PASS: 400 `BAD_REQUEST`
- FAIL: 200 with rows → R-4 fix missing.

**F2. LIKE wildcard escape**
```
curl 'https://<prod>/api/stores?q=%25' -b owner-cookie.txt
# %25 = URL-encoded `%`
```
- PASS: response contains only stores whose name literally has `%` (usually 0 rows)
- FAIL: returns all stores → escape missing.

**F3. Underscore wildcard escape**
```
curl 'https://<prod>/api/customers?q=_' -b cookie.txt
```
- PASS: 0 rows (or only customers with underscore in name)
- FAIL: returns random-matched single-char names → escape missing.

### Phase 4 — Distributed rate-limit (R-series) · 2 min

**R1. Parallel signup limit**
From two terminals simultaneously:
```
# Terminal 1 and 2 both fire 10× same-email signups in parallel
for i in $(seq 1 10); do
  curl -X POST https://<prod>/api/auth/signup \
       -H "Content-Type: application/json" \
       -d '{"email":"rl-test-1@qa.nox","password":"test1234","store":"마블","full_name":"QA","nickname":"QA","phone":"01099999999"}' &
done
wait
```
- PASS: combined accepted rows ≤ 5 (durable bucket limit). Rest are 429 / 409 EMAIL_TAKEN after first success.
- FAIL: >5 accepted → durable rate-limit not covering signup.

**R2. Window rollover**
After R1 trips, wait 61 seconds, then single request with fresh email.
- PASS: 200 OK
- FAIL: still 429 → the window isn't actually rolling, DB state stuck.

### Phase 5 — Recovery endpoint (B-series) · 1 min

**B1. Cron endpoint without secret**
```
curl -X POST https://<prod>/api/ops/apply-recovery/stale-pending \
     -H "Content-Type: application/json" -d '{}'
```
- PASS: 401 or 403 (no cron secret, no bearer)
- FAIL: 200 → endpoint is open.

**B2. Cron endpoint with secret**
```
curl -X POST https://<prod>/api/ops/apply-recovery/stale-pending \
     -H "x-cron-secret: <CRON_SECRET value>" \
     -H "Content-Type: application/json" \
     -d '{"target_store_uuid":"<any-valid-store-uuid>"}'
```
- PASS: 200 with summary body `{ok: true, target_store_uuid, summary: {scanned, eligible, ...}, outcomes: [...]}`
- FAIL: 401/403 → CRON_SECRET env mismatch or header name typo.

### Total smoke battery
**15 tests.** Expected wall time: ~12 minutes with one tester. Each test has a clear pass/fail boundary; do not rationalize borderline failures.

---

## 6. ROLLBACK ORDER

Invoke this ONLY when a smoke test fails AND the failure is production-facing.

### 6.1 Decision matrix

| Failing test | Severity | Rollback target |
|---|---|---|
| A1 (rate-limit) | 🟠 Degraded security but login works | Re-check migration 052 before rollback |
| A2 / A3 / A4 / A5 / A6 | 🔴 Auth transport broken | **Immediate rollback** |
| M1 | 🔴 Login broken for real users | **Immediate rollback** |
| M2 | 🟠 Auth permissiveness | Roll back if attackers could already bypass |
| M3 | 🟢 Data integrity but no user impact | Fix data; no rollback needed |
| F1 / F2 / F3 | 🟠 Injection possible but no immediate exploit observed | Roll back if exposed publicly; otherwise patch forward |
| R1 / R2 | 🟠 Rate-limit weak | Patch forward; durable limit is backup |
| B1 / B2 | 🟡 Cron broken | Patch forward; apply-recovery is a safety net only |

### 6.2 Rollback steps (in order)

**Step 1 — Revert deploy (OP, T+fail+0m):**
- Deploy platform → one-click rollback to previous production build
- DNS reverts automatically
- User impact: ~30 seconds of mixed 502s

**Step 2 — Migrations (DBA, T+fail+3m):**
- `053` (unique index) → safe to drop:
  ```sql
  DROP INDEX IF EXISTS public.ux_store_memberships_one_primary_per_profile;
  ```
- `052` (auth_rate_limits) → **DO NOT drop** even on rollback. The old code may try `tickAttempt()` against it; dropping breaks the old path. Keep it; it's harmless to have the table without the new callers.

**Step 3 — Env rollback decision (OP, T+fail+5m):**
- Keep the new Supabase service_role key (the old one is already revoked; rolling back would require re-issuing a new one — do NOT reuse the revoked one)
- Keep `TRUSTED_PROXY` as-is
- Old build uses the same env vars; no action needed

**Step 4 — Verify rollback worked (QA, T+fail+10m):**
- Run A2, A5, M1 against production
- All three must PASS against the rolled-back build (they were green before this cutover)

**Step 5 — Post-mortem start (OP, T+fail+15m):**
- Announce: "NOX cutover rolled back due to [test ID] failure. Production is stable on previous build."
- Open incident ticket. Capture:
  - The failing smoke test ID and exact response
  - Server logs from the failed window
  - Which migration / code commit differs between rolled-back build and failed build

### 6.3 Do NOT rollback if:
- The failure is outside the smoke test matrix (e.g., a business-logic bug not covered by A/M/F/R/B). Cutover is about auth transport integrity, not full regression. Log and patch forward.
- The failure reproduces identically on preview URL (2.6) and nothing differs between preview and production. That means the bug is in code both versions share — rollback doesn't help.

---

## 7. FINAL CUTOVER READY: **YES** ✅ (code side)

### Code-side confirmations

| Gate | State |
|---|---|
| R-1 / R-2 / R-3 / R-4 / R-6 / R-7 fixes in mainline | ✅ all shipped |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ success |
| DB migrations committed (052, 053) | ✅ in `database/` |
| `DEPLOY_CHECKLIST.md` | ✅ present |
| `SECURITY_HANDOFF.md` | ✅ present |
| `CUTOVER_RUNBOOK.md` (this file) | ✅ present |

### Operator-side gates (still outstanding)

| Gate | Owner | Status |
|---|---|---|
| Legacy service_role key revoked on Supabase | OP | ⏳ operator action |
| Production env vars (§2.2) set | OP | ⏳ operator action |
| Production DB migrated (052 + 053) | DBA | ⏳ DBA action |
| `TRUSTED_PROXY` aligned to topology | OP | ⏳ operator action |
| Smoke tests A/M/F/R/B all green | QA | ⏳ post-deploy |

---

### 🟢 Code ships. Operator holds the trigger.

Execute §2 → §3 → §4 in order. Do not skip steps. Do not rationalize partial passes. If any smoke test fails, invoke §6 immediately.

**Runbook authored:** post R-1..R-7 security round. Valid until the next round introduces new auth surface — at which point this file must be re-validated and re-published.
