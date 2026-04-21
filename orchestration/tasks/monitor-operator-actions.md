You are working in the active NOX workspace:

C:\work\nox

This round is an OPERATOR ACTION LAYER for /counter/monitor.

==================================================
[OBJECTIVE]
==================================================

Enable operators (owner/manager) to click a worker avatar on the monitor map (or any row)
and execute operational decisions:

- "일중이다" (still working / mute alerts)
- "지금 시간까지 끝" (end at current time)
- "연장" (extend to next time)

This is a HUMAN CONFIRMATION layer.
BLE remains read-only and must NOT mutate business state.

==================================================
[STRICT RULES]
==================================================

- Do NOT change /counter transactional workflow
- Do NOT change session/participant/settlement logic paths directly
- Do NOT let BLE trigger any automatic mutation
- All actions must be explicit user actions
- Enforce resolveAuthContext + role (owner/manager only)
- Enforce store_uuid scope on every write
- Audit every action
- Keep implementation additive

==================================================
[REQUIRED IMPLEMENTATION]
==================================================

----------------------------------
1. ACTION UI (CLIENT)
----------------------------------

When clicking:
- map avatar
- room participant pill
- right panel row
- movement feed row (participant-linked)

Open a small action panel (popover or right drawer).

Show:
- name
- room
- current state (재실/이탈/화장실/외부)
- elapsed time
- manager (if available)

Buttons:
[일중이다]
[지금 시간까지 끝]
[연장]

----------------------------------
2. ACTION MEANING
----------------------------------

일중이다:
- mark operator override as "still working"
- mute repeated absence alerts
- DO NOT change session or participant status

지금 시간까지 끝:
- mark participant end at current timestamp
- DO NOT backdate
- DO NOT extend further

연장:
- increment extension count
- keep participant active
- record extension event

----------------------------------
3. SERVER API
----------------------------------

Create new route:

POST /api/sessions/participants/actions

Body:
{
  participant_id: string,
  action: "still_working" | "end_now" | "extend",
  effective_at?: string
}

Server must:
- resolveAuthContext
- require role owner|manager
- validate participant belongs to caller's store session
- validate session is active
- assertBusinessDayOpen (if available helper exists)
- insert action log (see below)
- return updated derived state

DO NOT:
- directly mutate settlement tables
- rely on BLE data

----------------------------------
4. ACTION LOG TABLE
----------------------------------

Create table:

session_participant_actions

Columns:
- id (uuid)
- store_uuid
- session_id
- participant_id
- action_type (text)
- acted_by_membership_id
- acted_at (timestamp)
- effective_at (timestamp)
- note (optional)
- extension_count (optional)

Index:
(store_uuid, participant_id, acted_at desc)

This is the source of truth for operator decisions.

----------------------------------
5. DERIVED STATE INTEGRATION
----------------------------------

Update /api/counter/monitor response:

For each participant:
- compute latest action (if exists)
- expose:
  operator_status:
    - normal
    - still_working
    - ended
    - extended
  extension_count

Client uses this to:
- mute alerts (still_working)
- show "연장 2회" badge
- hide ended participants on next poll

----------------------------------
6. CLIENT BEHAVIOR
----------------------------------

- Action buttons call API
- optimistic UI allowed but must rollback on failure
- after success:
  - refresh monitor snapshot (existing 7s poll or manual refresh)
- AbsencePanel:
  - still_working → remove alert
  - end_now → remove row next refresh
  - extend → keep row but mark extended

----------------------------------
7. SAFETY
----------------------------------

- No action allowed for unauthorized roles
- No cross-store mutation
- No BLE-triggered action
- No silent mutation
- All actions auditable

----------------------------------
8. VALIDATION
----------------------------------

- tsc must pass
- build must pass
- /counter remains unchanged
- BLE overlay remains read-only

==================================================
[OUTPUT FORMAT]
==================================================

1. FILES CHANGED
2. ACTION FLOW SUMMARY
3. API DESIGN
4. DATA MODEL
5. CLIENT BEHAVIOR
6. SAFETY CONFIRMATION
7. VALIDATION
8. REMAINING RISKS

==================================================
[FINAL RULE]
==================================================

This is a human-in-the-loop operational control layer.
Do not automate decisions.
Do not guess.
Do not break existing flows.