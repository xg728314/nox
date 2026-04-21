STEP-NEXT — OWNER ACCOUNT MANAGEMENT DESIGN LOCK

[STEP ID]
STEP-NEXT

[TASK TYPE]
design lock (no implementation)

[OBJECTIVE]
Define and lock the owner-level account management system for NOX.

This step establishes:

account management scope
status transition rules
API surface
UI structure
audit requirements

NO implementation allowed in this step.
NO speculative behavior allowed.

[CONTEXT]

Current state:

Signup / approval / login / recovery fully implemented
store_memberships is the authority layer
only approved accounts can log in
auth system is stable and verified

Next requirement:
Owner must be able to manage accounts within same store.

[SCOPE]

Design the following:

Account list (search + filter)
Account detail view
Status control actions
Owner-triggered password reset
Audit event tracking

[STRICT RULES]

1. Store Scope (ABSOLUTE)
ALL operations MUST be restricted by store_uuid
Owner can ONLY manage accounts within same store
Cross-store access = FORBIDDEN

FAIL IF:

Any API allows access to other store data
2. Role Authority
owner → full account management
manager → NO status change authority
hostess → NO account visibility (except self)

FAIL IF:

manager can approve/reject/suspend
hostess can view other accounts
3. Membership Status

Allowed values:

pending
approved
rejected
suspended
4. Status Transition Rules (LOCKED)

Allowed:

pending → approved
pending → rejected
approved → suspended
suspended → approved
rejected → approved (explicit only)

Forbidden:

approved → rejected
rejected → suspended

Reason:

rejected = signup denial
suspended = operational block

FAIL IF:

any undefined transition exists
approved → rejected allowed
5. Password Reset (Owner Trigger)
Owner can trigger reset email
ONLY for same-store accounts
Prefer approved accounts only

Response:

MUST NOT expose email existence externally
MUST log audit event

FAIL IF:

reset works across store
reset exposes account existence
6. Audit Logging (MANDATORY)

Every mutation MUST create audit_events row

Required fields:

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

Event types:

account_approved
account_rejected
account_suspended
account_reapproved
account_reset_password_sent

FAIL IF:

any mutation happens without audit log

[API DESIGN]

GET /api/owner/accounts

Query:

q (name / phone / email)
status
role
page
limit
sort

Rules:

owner only
filter by store_uuid
GET /api/owner/accounts/[membership_id]
owner only
same store_uuid
return profile + membership data
POST /api/owner/accounts/[membership_id]/approve
apply transition rules
write approved_by / approved_at
create audit event
POST /api/owner/accounts/[membership_id]/reject
pending only (recommended)
write rejected_by / rejected_at
create audit event
POST /api/owner/accounts/[membership_id]/suspend
approved only
write suspended_by / suspended_at
create audit event
POST /api/owner/accounts/[membership_id]/reset-password
trigger Supabase reset email
same store only
create audit event
GET /api/owner/accounts/[membership_id]/audit
return audit_events
filtered by target_membership_id

[DB EXTENSIONS]

store_memberships (add)
approved_by
approved_at
rejected_by
rejected_at
suspended_by
suspended_at
status_reason (nullable)
profiles (optional)
last_login_at (nullable)
audit_events (required)

Must support all account-related events

[UI DESIGN]

Route

/owner/accounts

List View

Filters:

search (name / phone / email)
status
role

Columns:

full_name
nickname
phone
email (masked or full for owner)
role
status
created_at
updated_at

Actions:

view detail
approve
reject
suspend
reset-password
Detail Panel

Fields:

profile_id
membership_id
store_uuid
full_name
nickname
phone
email
role
status
timestamps
approval / rejection / suspension metadata

Actions:

approve
reject
suspend
reset password
view audit

[VALIDATION CHECKLIST]

owner cannot access other store accounts
manager cannot change status
hostess cannot see other users
status transitions strictly enforced
audit log always created
password reset scoped and silent

[FORBIDDEN]

cross-store queries
direct use of profiles.store_uuid (must use membership)
skipping audit log
mixing UI logic before rules are locked
implementing before design is approved

[OUTPUT FORMAT]

Respond with:

ROUTE DESIGN SUMMARY
STATUS TRANSITION TABLE
API LIST
DB FIELD CHANGES
UI STRUCTURE
VALIDATION PLAN

[STOP CONDITION]

STOP after design is complete.

DO NOT:

write actual code
modify files
generate UI components
touch Supabase

This step is DESIGN LOCK ONLY.