# STEP-021 — SIGNUP / ONBOARDING DESIGN LOCK

**Status:** DESIGN LOCK ONLY — no code, no migration, no seed in this round.
**Audit basis:** repository state at C:\work\nox on 2026-04-16.
**Locked policy precedent:** STEP-020 (dead signup UI removal) — login screen now states "계정 발급 및 승인은 운영 관리자에게 문의하세요."
**Goal:** define the safest path to introduce a real user-facing signup flow that respects the existing approved-only login rule and reuses the existing approvals pipeline.

---

## 1. CURRENT CODE REALITY

All claims below were verified against the working tree.

### 1.1 Login surface — `app/login/page.tsx`

- Inputs: email (line 207), password (line 217), MFA TOTP code (lines 227–244, conditional), remember-device checkbox (line 250).
- Buttons: 로그인 (line 264), MFA 취소 (line 275, conditional).
- Footer copy (line 284): "계정 발급 및 승인은 운영 관리자에게 문의하세요."
- **No link to any signup page** — STEP-020 removed dead 계정 생성 / 승인 대기 확인 / 비밀번호 찾기 buttons.

### 1.2 Signup surface

- `app/signup/page.tsx` — **DOES NOT EXIST**.
- `app/api/auth/signup/route.ts` — **DOES NOT EXIST**.
- No "회원가입" / "signup" / "register" references remain in `app/`.

### 1.3 Login backend — `app/api/auth/login/route.ts`

- Membership filter (lines 68–74): `.eq("status","approved").is("deleted_at",null)`. `is_primary` is **not** filtered at login time.
- No-approved-membership response (lines 76–80): HTTP 401, body `{ error: "MEMBERSHIP_NOT_APPROVED", message: "승인되지 않은 계정입니다." }`.
- Success response (lines 140–147): `{ access_token, user_id, membership_id, role, store_uuid, mfa_enabled }`.
- The login route has **no concept of a pending user**. A pending row in `store_memberships` is invisible to login except as a 401.

### 1.4 Auth context resolver — `lib/auth/resolveAuthContext.ts`

- Recognized status enum (line 12): `"approved" | "pending" | "rejected" | "suspended"`.
- Hard block (lines 95–96): any status other than `approved` throws `AuthError("MEMBERSHIP_NOT_APPROVED")`. This is the system-wide gate; nothing else needs to enforce it.

### 1.5 Schema — `database/002_actual_schema.sql`

- `profiles` (lines 13–22): `id`, `full_name`, `phone`, `nickname`, `is_active`, timestamps. No uniqueness on phone. No uniqueness on nickname.
- `store_memberships` (lines 41–53): `id`, `profile_id`, `store_uuid`, `role`, `status` (**default `'pending'`** at line 46), `is_primary`, `approved_by`, `approved_at`, timestamps. **No `(profile_id, store_uuid, role)` UNIQUE constraint.**
- `stores` (lines 27–36): `id`, `store_name`, `store_code`, `floor`, `is_active`, timestamps. Sufficient for a store picker.
- `audit_events` (lines 300–316): `store_uuid`, `actor_profile_id`, `actor_role` are **NOT NULL**. `actor_membership_id` is nullable. **An audit row cannot be written without a `store_uuid` and a `actor_profile_id`.**
- No `signup_requests` table; no separate pending-applicant table.

### 1.6 Approvals pipeline — already exists and is the load-bearing target

- UI: `app/approvals/page.tsx` lists pending memberships (line 27 query).
- API: `app/api/store/approvals/route.ts`
  - GET (lines 8–64): lists memberships where `status='pending'` for the caller's store.
  - POST (lines 71–144): owner **and** manager (line 11, 74) can call with `{membership_id, action: "approve"|"reject"}`. The route flips `status` and stamps `approved_by` + `approved_at` (lines 108–116), then writes an `audit_events` row (lines 124–134) with `entity_table: "store_memberships"`.
- **Important:** today nothing in the codebase actually creates a `status='pending'` row. The approvals UI exists but has zero inbound flow. STEP-021 introduces the producer for this consumer.

### 1.7 Existing pending-row producers

- **None.** No API or UI path inserts `store_memberships` rows. The seed script writes `status:"approved"` directly. The schema default (`pending`) is currently dead.

### 1.8 Uniqueness state

- Supabase `auth.users.email` is unique by Supabase default — this is the **only** duplicate guard today.
- `profiles.phone` — no DB constraint.
- `store_memberships(profile_id, store_uuid, role)` — no DB constraint. Multiple rows are physically possible.

---

## 2. REQUIRED SIGNUP FIELDS (LOCKED)

User-confirmed inputs for the signup form. These four and only these four:

| Field        | Source            | Storage target                     | Notes |
|--------------|-------------------|------------------------------------|-------|
| Store        | dropdown          | `store_memberships.store_uuid`     | populated from `stores` where `is_active=true AND deleted_at IS NULL` |
| Real name    | text              | `profiles.full_name`               | required, non-empty after trim |
| Nickname     | text              | `profiles.nickname`                | required, non-empty after trim |
| Phone        | text (digits)     | `profiles.phone`                   | required, normalized (digits only) |

Email and password are **also** required because Supabase auth needs them to create the auth user. They are not "extra fields" — they are the credential. The login screen footer copy already implies the user knows their email; the signup form will explicitly collect both.

**Out of scope this round:** role selection. Every signup is implicitly `role='hostess'`. Owner and manager accounts continue to be provisioned by operators directly (matching today's reality).

---

## 3. SAFEST ONBOARDING FLOW

```
[Signup form]
   user enters: store, email, password, real name, nickname, phone
        │
        ▼
POST /api/auth/signup
   1. validate inputs (trim, regex, store exists & active)
   2. supabase.auth.admin.createUser({ email, password, email_confirm:true,
                                       user_metadata:{full_name, nickname, phone}})
   3. upsert profiles row (id from step 2, full_name, nickname, phone)
   4. insert store_memberships row:
        { profile_id, store_uuid, role:"hostess",
          status:"pending", is_primary:true }
   5. (best-effort) audit_events insert with entity_table="store_memberships",
      entity_id=membership.id, action="membership_requested",
      actor_profile_id=new profile id, actor_role="hostess",
      store_uuid=selected store
   6. respond 200 { ok:true, status:"pending" }
        │
        ▼
[Signup success screen]
   "가입 신청이 접수되었습니다. 운영자 승인 후 로그인할 수 있습니다."
        │
        ▼
   user attempts login   →   /api/auth/login returns 401
                              MEMBERSHIP_NOT_APPROVED
                              (already implemented, no change)
        │
        ▼
[Operator opens app/approvals]
   sees the new pending row
   clicks 승인 → POST /api/store/approvals { membership_id, action:"approve" }
   row flips to status="approved"
        │
        ▼
   user retries login → success
```

Why this flow is the safest:
- It produces exactly one new row in `store_memberships` per signup. No new tables, no new state machines.
- It piggybacks on the **already-implemented** approvals pipeline (UI + API + audit). No duplicate logic.
- It does not touch `app/api/auth/login/route.ts` — the existing 401 path already handles "user has only pending memberships" correctly.
- It does not touch `lib/auth/resolveAuthContext.ts` — the existing `approved`-only gate already covers post-login authorization.
- Email confirmation is set to `true` server-side so users do not need to click an email link before applying for approval. Approval is the human gate; email verification is unnecessary friction.

---

## 4. MEMBERSHIP / STATUS BEHAVIOR

- `store_memberships.status` lifecycle for a signup-originated row:
  - inserted as `pending` (matches schema default — explicit for clarity)
  - operator approve → `approved` (existing approvals route)
  - operator reject → `rejected` (existing approvals route)
  - no other transitions in scope this round
- `is_primary=true` on insert. Rationale: today's approvals route does not check `is_primary`; today's login route does not filter by it. Setting it true keeps the row consistent with the seed convention. If a user signs up at a second store later, that row will also default to `is_primary=true` — that is the same shape today's seed/test data has and is not a new problem.
- `approved_by` and `approved_at` remain NULL until the operator acts. STEP-021 does not pre-fill them.
- `role='hostess'` always. No UI for role choice.
- `deleted_at` NULL on insert.

---

## 5. PRE-APPROVAL LOGIN BEHAVIOR

**No change required.** The current login route already returns the correct 401 for pending-only users (section 1.3). The current login UI already surfaces the server's `message` field as an error string. A user who signs up and then immediately tries to log in will see "승인되지 않은 계정입니다." — which is the truth.

Optional copy improvement (not required this round): on the signup success screen, tell the user what to expect ("운영자 승인 후 로그인 가능"). This is a static text addition, not a behavior change.

The login screen footer copy from STEP-020 ("계정 발급 및 승인은 운영 관리자에게 문의하세요.") will become slightly inaccurate once signup ships — it should be updated **in the implementation round**, not now, to: "신규 가입은 운영자 승인 후 사용 가능합니다." This is noted here so the implementation round does not forget it.

---

## 6. APPROVAL UI IMPACT

The existing `app/approvals/page.tsx` and `app/api/store/approvals/route.ts` are **already wired for this exact shape**. The audit confirms:

- The list query is `status='pending'` scoped by store — signup rows will appear automatically.
- Both owner and manager can approve (matches today's operator carve-out).
- Audit is already written on approve/reject.

**Required UI additions in the implementation round** (out of scope here, listed for completeness):

1. The approvals list currently shows whatever fields the page currently selects. To make signup applications useful to operators, the list should display: full_name, nickname, phone, requested role (always hostess for now), requested_at (`created_at`). The existing `app/approvals/page.tsx` already joins to profiles for name; verify it surfaces phone and nickname before shipping.
2. No new approval action is needed — the existing approve/reject buttons cover the entire signup terminal state.

---

## 7. DUPLICATE / SAFETY RULES

The only DB-level uniqueness today is `auth.users.email`. To avoid race conditions and accidental duplicates without adding migrations in this round, the signup endpoint must enforce the following at the application layer:

| Rule | Enforcement | Rationale |
|------|-------------|-----------|
| email already exists in auth.users | `supabase.auth.admin.createUser` will fail; surface as `EMAIL_TAKEN` 409 | only DB-guaranteed uniqueness — must surface gracefully |
| email + selected store already has any non-rejected, non-deleted membership (pending or approved) | pre-check via `store_memberships.select().eq(profile_id,…).eq(store_uuid,…).is(deleted_at,null).neq(status,"rejected")` → 409 `ALREADY_REGISTERED_AT_STORE` | prevents double-pending spam from the same email at the same store |
| selected store_uuid not in stores or `is_active=false` or `deleted_at IS NOT NULL` | 400 `STORE_INVALID` | prevents pending rows attached to dead stores |
| full_name, nickname, phone empty after trim | 400 `MISSING_FIELDS` | basic input hygiene |
| phone fails `^[0-9]{9,15}$` after stripping non-digits | 400 `PHONE_INVALID` | stable storage shape |
| password fails Supabase minimum (currently 6 chars per Supabase default) | propagate Supabase error as 400 | matches existing login expectations |
| signup rate limit per IP (recommended) | reuse `lib/security/rateLimit` if present, key `signup:<ip>` 5/min | spam mitigation; not a new dependency if helper exists |

**Explicitly out of scope this round:**
- Adding a UNIQUE constraint on `store_memberships(profile_id, store_uuid)` — that is a migration. The pre-check above is the round-021 substitute. A migration can be added in a later round if operators see actual duplicate races.
- Phone uniqueness across profiles — no business rule confirmed.
- Email re-verification.
- CAPTCHA.

---

## 8. IMPLEMENTATION STEP BREAKDOWN (FUTURE ROUND, NOT THIS ROUND)

This section is the contract for the round that will follow STEP-021. It is **not** executed now.

### STEP-022-A — backend signup route
- **File created:** `app/api/auth/signup/route.ts`
- **No other file modified.**
- POST handler implementing section 3 + section 7 in order.
- Uses `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` directly, matching the auth/login route pattern (do not use the user-token client — there is no user yet).
- No call into `resolveAuthContext` (no Bearer token on signup).
- Returns one of: 200 `{ok:true,status:"pending"}`, 400 with error code, 409 with error code, 500 `INTERNAL_ERROR`.

### STEP-022-B — frontend signup page
- **File created:** `app/signup/page.tsx`
- **One file modified:** `app/login/page.tsx` to add a single "신규 가입 신청" link below the login button.
- Form fields: store dropdown (fetched from a small public list endpoint or a direct supabase anon read of `stores` — to be decided in 022-B audit), email, password, full_name, nickname, phone.
- On submit → POST `/api/auth/signup` → on success show static success screen with message about operator approval.
- No router push to any authenticated area (user has no token).

### STEP-022-C — approvals UI sanity pass
- **File potentially modified:** `app/approvals/page.tsx`
- Verify the list shows full_name + nickname + phone + role + created_at. Add the columns if missing.
- No API change.

### STEP-022-D — login footer copy update
- **File modified:** `app/login/page.tsx` line 284, copy change only:
  - from: "계정 발급 및 승인은 운영 관리자에게 문의하세요."
  - to: "신규 가입은 운영자 승인 후 사용 가능합니다."

### STEP-022-E — validation
- `npx tsc --noEmit`
- `npm run build`
- Manual: signup → see success screen → attempt login (expect 401) → operator approves → login succeeds.

Each sub-round is single-file (or single-file + one-line copy edit) per the EXECUTOR rule in CLAUDE.md.

---

## 9. NON-GOALS / EXPLICIT EXCLUSIONS

The following are **not** part of STEP-021 or its implementation rounds, to keep blast radius bounded:

- No new DB tables.
- No DB migrations (no `signup_requests`, no UNIQUE constraint additions).
- No changes to `app/api/auth/login/route.ts`.
- No changes to `lib/auth/resolveAuthContext.ts`.
- No changes to settlement, sessions, chat, inventory, MFA, reauth.
- No role selection in signup (always hostess).
- No email verification flow, no password reset flow, no "check my approval status" self-service endpoint.
- No notification (email/SMS/push) on approval.
- No bulk approval.
- No edits to `docs/**`.
- No changes under `C:\work\wind`.

---

## 10. DESIGN LOCK SUMMARY (one paragraph)

A user-facing signup will be added as a single new POST endpoint and a single new page. It collects store + email + password + real name + nickname + phone, creates a Supabase auth user, upserts a profile, and inserts exactly one `store_memberships` row with `role='hostess'` and `status='pending'`. From that point onward, every existing system component already does the right thing: the login route refuses pending users with the existing 401, the auth context resolver refuses pending users with the existing block, the approvals page already lists pending rows, the approvals POST already flips them to approved with audit. STEP-021 introduces no new state, no new table, no new role, and no change to authorization — it only fills the missing producer for the approvals consumer that has been waiting since day one.
