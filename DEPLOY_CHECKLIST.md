# NOX — Production Deployment Checklist

Generated after the R-1 → R-7 security round. Every item must be
confirmed before the first production traffic hits the new build.

---

## 1. Environment variables

On the production host (Vercel project settings / `.env.production`):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | New-format `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **Rotated key only** — the legacy `eyJhbGci...` one must be dead by this point |
| `MFA_SECRET_KEY` | ✅ | 32-byte base64. Distinct per environment |
| `DEVICE_HASH_SECRET` | ✅ | Trusted-device HMAC key |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | ✅ | Same value used during device-hash fallback |
| `CRON_SECRET` | ✅ | Used by `/api/ops/apply-recovery/stale-pending` |
| `TRUSTED_PROXY` | Conditional | Set to `"true"` **only** when deployed behind a reverse proxy that strips/overwrites client-supplied `X-Forwarded-For`. Do NOT set on Vercel/Cloudflare — their own headers are used automatically. Do NOT set on bare `next start` on a public IP |

Local secrets must never be committed. The `.gitignore` now covers `.env.local`, `.env`, `.env.*.local`, `.mcp.json`.

---

## 2. Legacy key destruction

- [ ] Supabase dashboard → Settings → API → confirm the legacy `eyJhbGci...` service_role key is **revoked** (not just "unused")
- [ ] GitHub secret-scanning alert for this repo (if any) is acknowledged and closed
- [ ] The production `.env` no longer references the old key (grep the deploy artifact)
- [ ] `git log -p | grep eyJhbGci` returns nothing in the active branch (NOT history — that is addressed separately, see §6)

---

## 3. DB migrations

Apply in order to production:

```
database/052_auth_rate_limits.sql
database/053_store_memberships_primary_unique.sql
```

These were previously applied to staging via MCP but were not committed as migration files. Now they are. Run them on production before cutting over.

**Pre-migration check (will be run by `053`):**
```sql
SELECT profile_id, COUNT(*) FROM public.store_memberships
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY profile_id HAVING COUNT(*) > 1;
```
Must return 0 rows. If not, resolve data before applying `053`; the migration intentionally fails loud.

---

## 4. TRUSTED_PROXY guidance (self-host only)

If you do NOT deploy on Vercel or Cloudflare and instead run `next start` behind nginx / Caddy / HAProxy:

1. Set `TRUSTED_PROXY=true` in the production env.
2. Configure the reverse proxy to:
   - **Strip** any client-supplied `X-Forwarded-For` before appending the real peer IP, or
   - **Overwrite** `X-Forwarded-For` with only the real peer IP.
3. Verify: from an untrusted network, send `curl -H "X-Forwarded-For: 1.2.3.4"` — the application log must NOT show `1.2.3.4` as the caller IP.

If you cannot guarantee the above, leave `TRUSTED_PROXY` unset. The application will treat every request as coming from `"unknown"` — rate-limit buckets collapse but spoof is impossible.

---

## 5. Post-deploy smoke tests

Minimum set, run against the newly deployed URL:

### Auth

| # | Action | Expected |
|---|---|---|
| A1 | `POST /api/auth/login` with wrong password × 11 | 11th returns 429 `RATE_LIMITED`. The durable rate-limiter (DB) is the enforcer |
| A2 | Login OK → verify `Set-Cookie: nox_access_token=...; HttpOnly; SameSite=Lax` | Present in response headers |
| A3 | `document.cookie` in browser console does NOT expose the token | R-1 requirement |
| A4 | `localStorage.getItem("access_token")` in browser console is `null` | R-1 |
| A5 | `POST /api/auth/logout` → subsequent `/api/auth/me` is 401 | Cookie cleared |
| A6 | `curl -H "Authorization: Bearer null"` to any authed API | 401 (not 200 with null user) |

### Membership consistency (R-6)

| # | Action | Expected |
|---|---|---|
| M1 | Login as a user with exactly one `is_primary=true` approved membership | 200 with correct `role`/`store_uuid` |
| M2 | Login as a user with zero approved memberships | 401 `MEMBERSHIP_NOT_APPROVED` |
| M3 | Manually UPDATE `store_memberships` to make two primary rows for the same profile (staging only) | `/api/auth/login` returns 500 `MEMBERSHIP_AMBIGUOUS`. `UPDATE` itself should fail against the `ux_store_memberships_one_primary_per_profile` index once migration 053 is applied |

### Filter-injection (R-4)

| # | Action | Expected |
|---|---|---|
| F1 | `GET /api/audit-events?q=foo,actor_profile_id.eq.<any-uuid>` | 400 `BAD_REQUEST` (comma rejected) |
| F2 | `GET /api/stores?q=%` | Returns stores whose name literally contains `%` (usually 0), not all stores |
| F3 | `GET /api/customers?q=_` | Same — escaped wildcard |

### Rate-limit consistency (R-7, multi-instance)

| # | Action | Expected |
|---|---|---|
| R1 | Rapid-fire 15 signup requests same email from 2 Vercel functions in parallel | Total accepted ≤ 5 (per durable limit) |
| R2 | After rate-limit trips, wait 60s → next request succeeds | Window rolls over |

### Recovery

| # | Action | Expected |
|---|---|---|
| B1 | `POST /api/ops/apply-recovery/stale-pending` without `x-cron-secret` | 401/403 |
| B2 | With matching `x-cron-secret` + valid body | 200, summary object |

---

## 6. Rollback points

Each commit in this security round is independently revertable:

| Commit / round | Safe to revert? | Consequence |
|---|---|---|
| R-1 (localStorage token removal) | 🟠 Requires coordinated re-deploy | Users would keep HttpOnly cookie but no apiFetch token path — login session breaks until revert is re-deployed |
| R-3 (IP extraction hardening) | ✅ Yes | Rate-limit coverage widens to include all spoofed IPs (bad), but nothing breaks |
| R-4 (filter injection) | ✅ Yes | Injection reopens (bad), but functional behavior identical |
| R-6 (is_primary filter + multi-row fail-closed) | ✅ Yes | Falls back to non-deterministic first-row membership pick |
| R-7 (durable rate-limit) | ✅ Yes | Falls back to in-memory only; serverless bypass possible again |
| Migration 052 (auth_rate_limits) | 🔴 Do not revert | The application depends on the table/RPC existing. Rolling back drops the security enforcement |
| Migration 053 (is_primary unique index) | ✅ Yes | Index drop cannot violate anything; application still fails closed on multi-row |

Deploy strategy: **R-1** is the highest-risk revert. Verify A1-A6 smoke tests before publicizing the new URL / completing DNS cutover.

---

## 7. Open follow-ups (NOT deploy-blocking)

See `SECURITY_HANDOFF.md` for full classification. Summary:

- **R-5** (pricing `?? 30000` hardcoded fallback) — code bug, store-specific pricing risk. Safe after deploy; stores with a complete `store_service_types` row are unaffected. Fix in next round.
- **R-8** (CRON_SECRET timing-unsafe compare) — theoretical. Non-blocking.
- **R-9** (signup `listUsers()` first-page only) — UX/correctness bug in duplicate-email check. Non-exploit path. Non-blocking.
- **Git history rewrite** — the legacy `eyJhbGci...` key is dead (rotated), so history is historical trivia. BFG/filter-repo can be run in a separate ops window; no production traffic impact.

---

## 8. Deploy go/no-go gate

All of the following must be **true** to deploy:

- [ ] §1 env vars present
- [ ] §2 legacy key destroyed
- [ ] §3 migrations 052, 053 applied and `053` pre-check passes
- [ ] §4 `TRUSTED_PROXY` set correctly for your topology
- [ ] `npx tsc --noEmit` → 0 errors (verified)
- [ ] `npm run build` → success (verified)
- [ ] §5 smoke tests A1–A6, M1–M3, F1–F3, R1–R2, B1–B2 all pass

When all boxes ticked: **GO**.
