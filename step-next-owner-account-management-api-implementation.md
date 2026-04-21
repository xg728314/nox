STEP-NEXT — OWNER ACCOUNT MANAGEMENT API IMPLEMENTATION

[STEP ID]
STEP-NEXT-API

[TASK TYPE]
controlled implementation

[OBJECTIVE]
Implement the owner-level account management API for NOX based only on the locked design.

This step is API implementation only.

Implement:

account list
account detail
approve
reject
suspend
owner-triggered password reset
audit lookup

DO NOT implement UI in this step.
DO NOT redesign rules in this step.

[PREREQUISITE]

Use the locked rules from:

owner account management design lock
existing auth/store scope rules
existing NOX security rules

If any design point is unclear, do NOT invent behavior.
Use only already locked behavior.

[SCOPE]

Allowed implementation targets:

GET /api/owner/accounts
GET /api/owner/accounts/[membership_id]
POST /api/owner/accounts/[membership_id]/approve
POST /api/owner/accounts/[membership_id]/reject
POST /api/owner/accounts/[membership_id]/suspend
POST /api/owner/accounts/[membership_id]/reset-password
GET /api/owner/accounts/[membership_id]/audit

[STRICT RULES]

1. Role gate first

Every route MUST:

resolve auth first
reject unauthenticated first
reject non-owner before DB access

Required behavior:

owner only
manager forbidden
hostess forbidden

FAIL IF:

role gate happens after DB query
manager can mutate account status
hostess can access owner account APIs
2. Store scope is absolute

All queries and mutations MUST be restricted by:

authContext.store_uuid
target membership same store only

DO NOT trust client-provided store identifiers.

FAIL IF:

any route can read/write cross-store account data
membership is queried without same-store restriction
3. Authority source

Use store_memberships as authority source.

Do NOT use profiles.store_uuid as management scope source.
Do NOT derive authority from profile-only records.

FAIL IF:

profile-only scoping is used
membership authority is bypassed
4. Status rules (LOCKED)

Allowed values:

pending
approved
rejected
suspended

Allowed transitions:

pending -> approved
pending -> rejected
approved -> suspended
suspended -> approved
rejected -> approved (explicitly supported)

Forbidden:

approved -> rejected
rejected -> suspended
undefined transitions

FAIL IF:

invalid transitions are allowed
status update is done without old/new validation
5. Audit logging mandatory

Every mutation route MUST create audit_events row.

Required for:

approve
reject
suspend
reset-password

Audit row must include:

actor_user_id
actor_role
store_uuid
target_membership_id
target_profile_id
old_status
new_status
action_type
reason (nullable)
created_at

FAIL IF:

mutation succeeds without audit log
actor/target/store fields missing
6. Reset-password behavior

Owner-triggered password reset:

same store only
approved account only
must not expose unauthorized account existence
must create audit event

FAIL IF:

reset works for other store
reset works for non-approved account unless explicitly locked otherwise
reset route leaks sensitive existence information
7. API-only step

This step must NOT:

create UI pages
add client components
redesign workflow
change unrelated auth flows
touch signup/login/find-id/reset-password pages unless strictly required for API integration

FAIL IF:

implementation spills into UI
unrelated auth behavior changes

[TARGET FILES]

Allowed new/modified files should be limited to API and minimal supporting server utilities only.

Preferred route targets:

app/api/owner/accounts/route.ts
app/api/owner/accounts/[membership_id]/route.ts
app/api/owner/accounts/[membership_id]/approve/route.ts
app/api/owner/accounts/[membership_id]/reject/route.ts
app/api/owner/accounts/[membership_id]/suspend/route.ts
app/api/owner/accounts/[membership_id]/reset-password/route.ts
app/api/owner/accounts/[membership_id]/audit/route.ts

Allowed support files only if required:

lib/auth/*
lib/server/*
lib/validation/*
lib/audit/*

[FORBIDDEN FILES]

Do NOT modify unless absolutely required and directly justified:

app/signup/*
app/login/*
app/find-id/*
app/reset-password/*
app/approvals/*
UI pages/components outside owner account API scope
package.json
package-lock.json
next.config.*
tsconfig.json
unrelated settlement/chat/counter files

FAIL IF:

unrelated feature areas are modified

[DATA ACCESS REQUIREMENTS]

GET /api/owner/accounts

Return same-store account list only.

Support filters:

q
status
role
page
limit
sort

Search fields may include:

full_name
nickname
phone
email

Return joined profile + membership summary only.

GET /api/owner/accounts/[membership_id]

Return:

membership core fields
profile core fields
status metadata
timestamps

Must verify:

membership exists
membership belongs to same store_uuid as authContext
POST /api/owner/accounts/[membership_id]/approve

Allowed when:

current status = pending
OR current status = suspended
OR current status = rejected (if explicitly supported)

Must:

validate transition
update status
set approved_by / approved_at
create audit row
POST /api/owner/accounts/[membership_id]/reject

Allowed when:

current status = pending only

Must:

validate transition
update status
set rejected_by / rejected_at
create audit row
POST /api/owner/accounts/[membership_id]/suspend

Allowed when:

current status = approved only

Must:

validate transition
update status
set suspended_by / suspended_at
create audit row
POST /api/owner/accounts/[membership_id]/reset-password

Allowed when:

target account exists in same store
target status = approved

Must:

trigger reset flow using existing server-safe mechanism
avoid leaking extra auth details
create audit row
GET /api/owner/accounts/[membership_id]/audit

Return audit rows for target membership only.

Must be same-store restricted.

[RESPONSE REQUIREMENTS]

Use explicit structured JSON.

Error shape should remain consistent with existing NOX route style.

Recommended patterns:

401 unauthorized
403 role_forbidden
404 not_found
409 invalid_status_transition
400 invalid_request
500 internal_error

Do not invent user-friendly UI text.
API responses only.

[VALIDATION REQUIREMENTS]

Minimum required validation:

membership_id UUID validation
role gate validation
same-store scope validation
status transition validation
required param validation
audit write success validation

[IMPLEMENTATION NOTES]

Follow existing NOX route conventions
Apply auth and role checks before DB access
Keep handlers narrow and explicit
Prefer server-side helper reuse where already available
No broad refactor in this step

[REQUIRED VERIFICATION]

Must run and report:

TypeScript check
tsc --noEmit
Production build
npm run build
API behavior verification summary
Include at least:
owner access success
manager forbidden
hostess forbidden
cross-store blocked
approve valid transition success
reject invalid transition blocked
suspend valid transition success
reset-password restricted correctly
audit log created on mutation

If direct runtime testing is not possible, clearly state what was validated statically vs functionally.

[OUTPUT FORMAT]

Respond with exactly:

FILES CHANGED
ROUTE BEHAVIOR SUMMARY
STATUS TRANSITION ENFORCEMENT
AUDIT LOGGING SUMMARY
VALIDATION
RISKS / FOLLOW-UPS

[STOP CONDITIONS]

STOP after API implementation and verification.

DO NOT:

implement UI
redesign statuses
touch unrelated features
make speculative schema rewrites

This step is OWNER ACCOUNT MANAGEMENT API IMPLEMENTATION ONLY.