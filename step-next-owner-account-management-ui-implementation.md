STEP-NEXT — OWNER ACCOUNT MANAGEMENT UI IMPLEMENTATION

[STEP ID]
STEP-NEXT-UI

[TASK TYPE]
controlled implementation

[OBJECTIVE]
Implement the owner account management UI for NOX using the already locked design and the owner account management API.

This step is UI implementation only.

Implement:

owner account list page
filters
detail panel or detail view
action controls for approve / reject / suspend / reset-password
audit view linkage or inline audit section

DO NOT redesign rules in this step.
DO NOT change API contracts in this step unless strictly required for integration and explicitly justified.

[PREREQUISITE]

Use only:

locked owner account management design
implemented owner account management API
existing NOX auth / store scope / role rules

If something is unclear:

do not invent behavior
do not redesign statuses
do not change business rules

[SCOPE]

Implement owner-side UI only for:

/owner/accounts page
search / filter controls
account table/list
account detail panel or detail page
action buttons:
approve
reject
suspend
reset-password
audit visibility path

[STRICT RULES]

1. UI must not redefine authority

UI must reflect server authority only.

owner-only UI
no manager authority expansion
no hostess visibility expansion

FAIL IF:

UI implies manager can approve/reject/suspend
UI shows cross-store data
UI contains actions not supported by server rules
2. No business rule redesign

Use locked status values only:

pending
approved
rejected
suspended

Use locked transitions only:

pending -> approved
pending -> rejected
approved -> suspended
suspended -> approved
rejected -> approved (if supported by API)

FAIL IF:

UI introduces new statuses
UI allows forbidden transitions
UI labels alter meaning of rejected vs suspended
3. API-driven behavior only

UI must use implemented API routes.

Do NOT bypass API.
Do NOT embed direct DB logic in client components.

FAIL IF:

UI directly depends on DB-only assumptions
UI requires unimplemented endpoints without explicit note
4. Scope and visibility

UI must be owner-only and same-store operational UI.

Do not build superadmin/global account UI.

FAIL IF:

multi-store/global management concepts appear
owner page shows data outside same store context
5. Minimal integration risk

Do not refactor unrelated screens.

Allowed target area:

owner account management page/components only

FAIL IF:

signup/login/approval/recovery flows are changed without need
unrelated pages are modified broadly
6. Clear operational UX

UI must prioritize actual operation:

fast search
quick status recognition
safe action triggering
basic confirmation for status-changing actions
visible result/error state

FAIL IF:

status actions are ambiguous
dangerous actions have no confirmation
operator cannot tell current account state quickly

[ROUTE TARGET]

Primary UI route:

/owner/accounts

[EXPECTED UI STRUCTURE]

A. Page header
title
short purpose text
optional count summary by status
B. Filter/search row
text search (name / nickname / phone / email)
status filter
role filter
refresh button
C. Account list/table

Columns:

full_name
nickname
phone
email
role
status
created_at
updated_at
actions
D. Actions

Per row or detail panel:

view detail
approve
reject
suspend
reset-password
E. Detail panel/page

Show:

profile + membership core info
timestamps
approval/rejection/suspension metadata
audit preview or audit section

[UX REQUIREMENTS]

Status display

Status must be visually clear:

pending
approved
rejected
suspended
Actions by state

Recommended behavior:

pending: approve / reject
approved: suspend / reset-password
suspended: approve (reactivate) / reset-password (only if allowed)
rejected: approve only if supported
Confirmation

Require confirmation before:

reject
suspend
reset-password
Error handling

Display API error result clearly.
Do not hide failures silently.

Empty state

Show clear empty state for:

no matching search result
no accounts in selected filter
Loading state

Show loading state for:

initial fetch
mutation in progress
detail fetch if separate

[DATA REQUIREMENTS]

Use API data only.

List page should support:

q
status
role
page / limit if implemented
sort if implemented

Detail view should show:

membership_id
profile_id
store_uuid
full_name
nickname
phone
email
role
status
created_at
updated_at
approved/rejected/suspended metadata

Audit section should show if available:

action_type
old_status
new_status
actor
created_at
reason

[TARGET FILES]

Preferred target area only:

app/owner/accounts/page.tsx
app/owner/accounts/*
components/owner/accounts/*
lib/client/*
minimal API integration helpers if required

Use existing project structure if owner page area is already organized differently.

[FORBIDDEN FILES]

Do NOT modify unless directly required:

app/signup/*
app/login/*
app/find-id/*
app/reset-password/*
app/approvals/*
unrelated counter/chat/settlement pages
package.json
package-lock.json
tsconfig.json
next.config.*

FAIL IF:

unrelated feature areas are modified
this step expands into settlement or printer work

[VALIDATION REQUIREMENTS]

Must verify:

page renders
owner can load account list
filters work
detail view works
approve action updates UI correctly
reject action updates UI correctly
suspend action updates UI correctly
reset-password action returns visible success/failure feedback
manager/hostess cannot use owner UI path
build remains clean

Required checks:

tsc --noEmit
npm run build

If runtime verification is partial, state clearly what was verified and what remains manual.

[OUTPUT FORMAT]

Respond with exactly:

FILES CHANGED
UI BEHAVIOR SUMMARY
ACTION FLOW SUMMARY
API INTEGRATION SUMMARY
VALIDATION
RISKS / FOLLOW-UPS

[STOP CONDITIONS]

STOP after owner account management UI implementation and validation.

DO NOT:

redesign account rules
change unrelated auth flows
implement settlement features
implement printer features
touch unrelated pages

This step is OWNER ACCOUNT MANAGEMENT UI IMPLEMENTATION ONLY.