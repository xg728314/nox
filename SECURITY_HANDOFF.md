# NOX — Security Handoff (post R-1..R-7 round)

**Status:** core production-blocking security items closed. Deployment green-lit subject to `DEPLOY_CHECKLIST.md`.

This document is the single source of truth for "what was fixed, what remains, what to do next."

---

## 1. What was fixed

| ID | Issue | Round | Files touched (highlights) | Status |
|---|---|---|---|---|
| R-1 | `access_token` stored in `localStorage` (XSS-exploitable) | R-1 | `lib/auth/resolveAuthContext.ts`, `lib/apiFetch.ts`, `lib/auth/useCurrentProfile.ts`, `components/auth/ApprovedGate.tsx`, 44 pages | ✅ CLOSED |
| R-2 | `apiFetch` sent `Authorization: Bearer null` when token missing | folded into R-1 | `lib/apiFetch.ts` (now cookie-only, `credentials:"include"`) | ✅ CLOSED |
| R-3 | `X-Forwarded-For` trusted unconditionally → rate-limit bypass | R-3 | `lib/security/clientIp.ts` (new), `lib/audit/authSecurityLog.ts`, `app/api/auth/reset-password/route.ts`, `app/api/auth/find-id/route.ts` | ✅ CLOSED |
| R-4 | PostgREST `.or()` / LIKE filter injection via `q` | R-3 | `lib/security/postgrestEscape.ts` (new), 5 route files | ✅ CLOSED |
| R-6 | `login/*` membership query missing `is_primary=true` + no multi-row handling | R-6 | 3 login routes, `resolveAuthContext.ts`, `middleware.ts` + DB migration `053` | ✅ CLOSED |
| R-7 | In-memory rate-limit bypassable in serverless / multi-instance | R-7 | `lib/security/rateLimitDurable.ts` (new), 9 endpoints + cross-store guard + DB migration `052` | ✅ CLOSED |

All 6 items have commit-level fixes, passing `tsc --noEmit`, passing `npm run build`, and documented smoke tests in `DEPLOY_CHECKLIST.md`.

---

## 2. What remains

Classification rubric:
- **BLOCK** — must be done before first production traffic
- **POST** — safe after deploy; schedule into next sprint
- **DOC** — documentation / ops hygiene only

| ID | Issue | Class | Rationale | Suggested owner |
|---|---|---|---|---|
| R-5 | `lib/session/services/pricingLookup.ts:58` — `?? 30000` hardcoded fallback when `store_service_types` row missing | POST | Fires only if a store is mis-configured (incomplete pricing seed). Every store that ran the documented seed has a `차3` row at 30,000원. Failing loud would prevent check-in; 30,000원 fallback matches the seeded value. **Fix:** throw instead of fallback — but ship first to avoid regression risk | Product + backend |
| R-8 | `app/api/ops/apply-recovery/stale-pending/route.ts:113` — `cronSecretHeader === cronSecretEnv` is not constant-time | POST | Network timing attacks against HTTP endpoint with ≥16-byte secret are not practically feasible. Fix is trivial (`crypto.timingSafeEqual`) but non-urgent | Security |
| R-9 | `app/api/auth/signup/route.ts:121` — `admin.auth.admin.listUsers()` only reads the first page (default 50 users). Duplicate-email detection misses users beyond page 1; also enables slow email enumeration on large tenants | POST | Race window: a second `createUser({ email })` would still fail at Supabase auth level, so no account is actually silently overwritten. The privacy concern (enumeration) is mitigated by existing per-email rate limit. Replace with paginated iteration or `getUserByEmail` when available | Backend |
| Debug `console.log` traces | 9 `console.error("[login] …")` lines in `app/api/auth/login/route.ts` | DOC | All are in error branches (catch/fail paths) and log structured error codes, not PII. Kept as operational observability. Consider switching to structured logger if sensitive fields leak in future | Ops |
| `X-Forwarded-For` in legacy comments | Comments reference old pattern in a few files | DOC | No functional impact | None |
| Git history contains `eyJhbGci...` | The rotated service-role key still appears in old git commits | DOC / POST | The key is **revoked** on Supabase side (per `DEPLOY_CHECKLIST.md` §2). Historical exposure is no longer exploitable. BFG / `git filter-repo` rewrite can run in a scheduled ops window without impacting production | Ops |
| `lib/mock/*.ts` + `_ble_wip/` directories | Legacy WIP code and mock fixtures live under `lib/` | POST | Can be imported by accident into production bundles. Move to `/tests/fixtures/` or delete. No known active import paths today | Backend |
| `app/test-offline/page.tsx` | Test-only page in production bundle | POST | Same as above; consider `NODE_ENV` gate or removal | Backend |
| Settlement namespace duplication (`/api/settlement/*`, `/api/settlements/*`, `/api/sessions/settlement/*`, `/api/sessions/[id]/settlement/*`) | Parallel namespaces for same domain | POST | Regression hotbed but not a security issue. Audit + consolidate in a dedicated refactor round | Backend |

**None of the remaining items are production-blocking.**

---

## 3. New DB artifacts committed this round

```
database/052_auth_rate_limits.sql           -- table + 3 RPCs (tick_attempt, record_failure, clear)
database/053_store_memberships_primary_unique.sql  -- partial UNIQUE index enforcing is_primary invariant
```

Both were already live on staging (applied via MCP). They are now committed so fresh environments can be reconstructed from `git` alone.

---

## 4. New library modules committed this round

```
lib/security/clientIp.ts            -- non-spoofable IP extraction
lib/security/postgrestEscape.ts     -- LIKE / .or() escape helpers
lib/security/rateLimitDurable.ts    -- DB-backed rate limiter wrapping tickAttempt
```

Existing modules hardened: `lib/security/authRateLimit.ts` (widened `RateLimitAction` union), `lib/apiFetch.ts` (cookie-only), `lib/auth/resolveAuthContext.ts` (cookie + is_primary fail-closed), `lib/auth/useCurrentProfile.ts` (server-fetch instead of localStorage).

---

## 5. Deploy go/no-go

See `DEPLOY_CHECKLIST.md` for the full gate.

| Gate | State |
|---|---|
| Core security items (R-1..R-7) | ✅ all fixed |
| DB migrations committed | ✅ 052, 053 present |
| `tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ success |
| Legacy service_role key rotation | 🔲 operator-confirmed required |
| Env vars populated on production | 🔲 operator-confirmed required |
| Smoke tests pass | 🔲 operator-run required after deploy |

**Verdict:** code-side is **GO**. Two operator confirmations (key rotation, env vars) and post-deploy smoke tests remain before public cutover.

---

## 6. Known architectural limits (not security, for awareness)

- **RLS disabled** (MVP policy, see `database/002_actual_schema.sql`) — every store-scope boundary is enforced in application code via `.eq("store_uuid", authContext.store_uuid)`. A missing filter in a new API route is a data-leak risk. Mandatory code-review checklist: does every write / sensitive read carry the store filter?
- **In-memory cache maps** — `lib/security/guards.ts` rate-limit (now fast-path only) and `preferencesStore` live in process memory. Safe today; revisit if multi-region or large-scale deploy demands cross-instance state.
- **Supabase Realtime channels** are not used except in `reset-password/confirm` (URL-hash recovery flow). Future realtime work needs explicit authz review because `access_token` cookie is HttpOnly; Supabase client auth via `supabase.auth.setSession(...)` from the browser is no longer the path.

---

## 7. Contact / next round

When the next security round opens:

- Start with **R-5** (pricing fallback) — smallest blast radius, easiest fix.
- Then **R-9** (signup pagination) — affects duplicate detection correctness.
- Then **R-8** (timing-safe cron compare) — closes the last theoretical timing vector.
- WIP/test cleanup (`_ble_wip/`, `lib/mock/`, `app/test-offline`) — bundle hygiene.
- Settlement namespace consolidation — separate refactor track.

Each of these is safe to ship independently. None requires a coordinated cutover.
