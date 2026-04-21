You are reviewing the current NOX codebase in C:\work\nox.

This is NOT a generic code review.
This is a SECURITY + AUTHORIZATION + DATA-SCOPE + FUTURE-BLE-READINESS review.

You must first understand the current implemented system state before suggesting any fixes.

==================================================
[PROJECT CONTEXT — MUST UNDERSTAND FIRST]
==================================================

NOX is the active workspace.
Path:
C:\work\nox

C:\work\wind is reference only.
Do not treat wind as active implementation target.

Current NOX state already includes:
1. counter customization system
2. user preferences
3. admin forced preference override
4. room layout / sidebar layout customization
5. preset system
6. role-based menu filtering
7. live propagation via shared preferences store
8. owner / manager / hostess role model
9. store_uuid as absolute security scope
10. new top-level global admin requirement above owner
11. future BLE integration design is planned, but BLE runtime is NOT yet the active production path
12. current operation is still manual-first, and BLE must be additive, not destructive

The system is for nightlife venue operations.
The current critical principle is:

- manual operation must remain usable
- future BLE mode must not break manual operation
- security scope must remain strict
- UI hidden = API blocked
- store_uuid is the only security scope SSOT
- room_no is display only, never scope
- room_uuid is room identity
- session_id is runtime identity

Business day rule is locked:
a business day remains open until explicit closing action.
No fixed midnight cutoff.

==================================================
[LOCKED SECURITY / DOMAIN RULES]
==================================================

These rules are locked and must be assumed true:

1. store_uuid is the absolute isolation boundary across API / DB / UI / RLS
2. role and affiliation should resolve from store_memberships-based auth context
3. user preference table and admin override table must remain separated
4. runtime layout/menu resolution priority must remain:
   forced store
   -> forced global
   -> user store
   -> user global
   -> default
5. locked room layout components must not be hideable/movable
6. forbidden menu items must not render even if malformed config is injected
7. role filtering must exist both in UI and runtime resolution
8. API access must be denied even if UI is bypassed
9. future BLE data must never become a direct trust source without explicit operational resolution
10. manual input mode must remain available even after BLE integration
11. when a cross-store worker is actively working inside the current store session, visibility may be allowed for that active session only
12. after that active session ends, the foreign worker should no longer remain visible to unrelated stores/users
13. home-store owner/manager visibility and current working-store visibility must be strictly separated by policy

==================================================
[WHAT YOU MUST DO]
==================================================

Your task is to inspect the CURRENT IMPLEMENTED NOX CODEBASE and produce a security review focused on:

A. current vulnerabilities
B. missing authorization boundaries
C. weak store scope enforcement
D. RLS / API mismatch risk
E. admin override abuse risk
F. preferences/config injection risk
G. future BLE integration attack surface
H. manual-mode / BLE-mode conflict risk
I. foreign worker visibility leakage risk
J. global admin introduction risk

This is NOT a feature request round.
Do NOT redesign everything.
Do NOT propose speculative architecture unless required by an actual security finding.

You must review actual code and actual routes/files.
No guessing allowed.

==================================================
[REVIEW TARGETS — MUST COVER]
==================================================

You must inspect at minimum the following areas if they exist:

1. auth / authorization
- resolveAuthContext
- role gates
- membership status checks
- pending / rejected / suspended blocking
- owner / manager / hostess / global admin differentiation

2. API routes
Especially:
- /api/me/preferences
- /api/admin/preferences
- counter-related routes
- room/session/participant/order/settlement related routes
- any store dashboard / owner dashboard / manager dashboard routes
- any route that reads or writes user_preferences or admin_preference_overrides
- any route likely to be reused for BLE later

3. DB / SQL / migrations
Especially:
- user_preferences
- admin_preference_overrides
- store_memberships
- rooms
- room_sessions
- session_participants
- participant_time_segments
- receipts / settlements
- any policy or trigger affecting store scope
- any RPC used for payment/checkout flows

4. UI trust boundaries
Especially:
- CounterSidebar
- CounterSettingsModal
- RoomLayoutEditor
- SidebarLayoutEditor
- preferencesStore
- useRoomLayout
- useMenuConfig
- any place where hidden menu/locked widget rules are enforced only in UI
- any place where role filtering happens only client-side

5. future BLE-readiness surface
Even if BLE is not yet implemented, identify where current code would become dangerous if BLE presence/location data were later attached.
Examples:
- client-trusted state transitions
- session participant auto-creation paths
- time segment mutation paths
- visibility queries that would leak foreign workers
- routes that could be abused by fake presence events later

==================================================
[VERY IMPORTANT REVIEW QUESTIONS]
==================================================

You must answer all of these from actual code evidence:

1. Can a user from store A read or mutate anything from store B by:
- URL param spoofing
- store_uuid body injection
- malformed preference payload
- admin override misuse
- room/session UUID guessing
- client-side hidden menu bypass

2. Can manager/owner/global-admin boundaries be bypassed anywhere?

3. Is global admin already partially present in code in an unsafe/inconsistent way?

4. Can malformed customization payloads cause:
- forbidden menu rendering
- locked widget deletion
- runtime crash
- privilege escalation
- hidden but still callable features

5. Are there any routes where UI hides access but backend still allows it?

6. If future BLE data later writes into participant/session/time state, which existing code paths are too dangerous to reuse directly?

7. Is there any risk that foreign-store worker tracking could remain visible after session end?

8. Can current preferences or override APIs be abused to affect users outside intended scope?

9. Are any tables or routes missing versioning / optimistic concurrency / conflict control where it matters for operational integrity?

10. Are there any current logging/audit blind spots that would become critical once BLE + admin override are both active?

==================================================
[REQUIRED OUTPUT FORMAT]
==================================================

Return ONLY in this exact format:

# NOX SECURITY REVIEW

## 1. REVIEWED FILES
- exact file paths reviewed

## 2. CONFIRMED SAFE AREAS
- only items confirmed from code
- no assumptions

## 3. CONFIRMED SECURITY ISSUES
For each issue use:
- ID
- Severity (Critical / High / Medium / Low)
- Exact file/path
- Exact function/route/component
- Root cause
- Real exploit path
- Why it matters in current NOX
- Why it matters even more for future BLE/manual hybrid mode
- Required fix (minimal safe fix, not broad rewrite)

## 4. AUTHORIZATION GAPS
- role/scope/status enforcement gaps

## 5. STORE ISOLATION GAPS
- anything that could violate store_uuid boundary

## 6. CLIENT-TRUST RISKS
- places where client state/config is trusted too much

## 7. FUTURE BLE-READINESS RISKS
- current code paths unsafe for BLE attachment later

## 8. GLOBAL ADMIN RISKS
- current blockers/risks before introducing top-level admin

## 9. AUDIT / FORENSICS GAPS
- what is not logged but should be

## 10. PRIORITIZED FIX ORDER
- P0 must fix before BLE
- P1 should fix before wider rollout
- P2 later hardening

## 11. DO NOT CHANGE
- things that are currently correct and must remain unchanged

==================================================
[STRICT RULES]
==================================================

- NO GUESSING
- NO “probably”
- NO generic best-practice filler
- only actual findings from current code
- if something is not verified, mark it UNVERIFIED
- prefer minimal targeted fixes over rewrite proposals
- do not modify code yet
- this round is review only

Before writing the report, inspect the current repository thoroughly.