You are working in the active NOX workspace:

C:\work\nox

This round is NOT a rewrite.
This round is a focused UI/UX refinement round for the already-implemented Counter Monitoring V2 screen.

==================================================
[OBJECTIVE]
==================================================

Refine the existing /counter/monitor implementation so it reaches the intended high-confidence operational dashboard level.

The current structure is already correct:
- left room list
- center floor/zone map
- right visibility panels
- lower movement feed
- manual-first operation
- future BLE overlay placeholder

Do NOT rebuild it.
Do NOT change the core data model unnecessarily.
Do NOT touch the existing transactional /counter workflow.

This round is about turning the current monitoring screen from a "developer monitor" into a "real operator decision UI".

==================================================
[CURRENT BASELINE — MUST PRESERVE]
==================================================

Already implemented and must remain intact:
- /counter/monitor route
- /api/counter/monitor read-only derived snapshot endpoint
- owner/manager-only API gate
- server-side visibility policy as the single source of truth
- foreign-worker visibility only during active current-store sessions
- session-end removal behavior
- manual-first mode
- BLE placeholder block only (no trust integration yet)

Do NOT weaken or bypass any of the above.

==================================================
[PRIMARY GOALS FOR THIS ROUND]
==================================================

Upgrade the existing monitor UI in these 3 priority areas:

1. STATUS CLARITY
Make participant/worker state instantly readable:
- 재실
- 이탈
- 화장실
- 외부(타층)

These must become visually obvious through:
- strong color system
- clear state badges
- icon support where useful
- consistent usage across:
  - room list
  - map markers
  - right-side panels
  - summary bar
  - alerts

2. MOVEMENT PATH VISUALIZATION
The floor map must show recent movement path(s), not just static zone placement.

Requirements:
- show last movement path for a selected or highlighted worker
- path should be simple, readable, premium
- use dotted/soft directional line with arrow or equivalent
- support patterns like:
  room -> counter
  room -> restroom
  room -> elevator -> external floor
- do NOT turn the map into GPS-like animation
- do NOT show too many simultaneous paths
- default to one primary highlighted path only

3. ACTIONABLE ABSENCE UI
The right-side absence/alert area must become an operator action surface.

Add action UI for absence-related rows:
- 복귀 처리
- 종료 처리
- 무시

Important:
- this round may implement UI wiring safely
- if mutation endpoints already exist and are safe to call, connect appropriately
- if not, create only safe stubs / disabled actions / TODO-safe handlers with clear separation
- do NOT invent unsafe direct BLE-driven writes
- do NOT add automation that mutates settlement/session state from inferred BLE data

==================================================
[DETAILED UX REQUIREMENTS]
==================================================

A. STATUS SYSTEM

Create a unified visual status system:

- 재실 = green
- 이탈 = orange/amber
- 화장실 = purple
- 외부(타층) = blue

These states must appear consistently:
- room card participant rows
- map marker chips/avatars
- right-side lists
- summary cells
- alert rows

Avoid subtle styling.
This must be glance-readable in a dark environment.

B. MAP PATH UX

The map must remain zone-based, not coordinate-exact.

Add:
- selected worker highlight
- last-known movement path overlay
- clear source zone and destination zone
- optional small label near selected path
- do not render multiple noisy paths by default
- fallback gracefully if path data is incomplete

The visual result should feel operational, not decorative.

C. ABSENCE ACTION PANEL

For workers in absence-like states (이탈 / 화장실 / 외부 candidate), render action controls in the right-side alert region.

Each row should clearly show:
- avatar / name
- origin/home-store hint when allowed
- current derived location/state
- elapsed time
- buttons:
  - 복귀 처리
  - 종료 처리
  - 무시

Behavior rules:
- do not expose actions to unauthorized roles
- do not let UI imply dangerous BLE automation
- if action is not safely connected yet, mark clearly and keep UI structure ready
- foreign worker rows must still disappear after session end

D. OPERATOR-FIRST READABILITY

The operator must be able to answer instantly:
- 누가 방에 있나?
- 누가 나갔나?
- 어디로 갔나?
- 언제부터 그 상태인가?
- 지금 내가 무엇을 눌러야 하나?

Optimize for those 5 questions.

==================================================
[IMPLEMENTATION RULES]
==================================================

1. Reuse the current monitoring screen structure
2. Prefer additive refinement over component replacement
3. Keep /api/counter/monitor as the main read model unless a small safe extension is necessary
4. Do not move visibility policy logic to client-side
5. Do not weaken role checks
6. Do not wire BLE into business writes
7. Do not touch settlement logic
8. Do not degrade /counter
9. Keep build and typecheck clean
10. Maintain current foreign-worker visibility guarantees

==================================================
[IF ACTION BUTTONS ARE WIRED]
==================================================

Only wire actions if a current safe path already exists or can be implemented with proper authorization.

Allowed:
- owner/manager-only safe mutations
- actions scoped through existing session/participant lifecycle rules
- explicit user-initiated actions only

Forbidden:
- BLE-inferred automatic participant close/start
- silent automatic cleanup that changes business state without explicit action
- bypassing existing mutation protections

If safe wiring is not feasible in this round, implement:
- full UI structure
- disabled buttons or guarded handlers
- clear notes in output explaining what remains blocked and why

==================================================
[FILES / AREAS TO REVIEW BEFORE CHANGING]
==================================================

Inspect the current monitor implementation first, including at minimum:
- app/counter/monitor/page.tsx
- app/api/counter/monitor/route.ts
- app/counter/monitor/components/*
- app/counter/monitor/hooks/useMonitorData.ts
- monitor shared types
- current room/session/participant mutation routes if considering action wiring
- existing role/auth helpers

Also inspect current counter room display patterns for consistency, but do NOT rewrite the transactional counter flow.

==================================================
[OUTPUT FORMAT]
==================================================

Return ONLY in this format:

1. FILES CHANGED
- exact paths
- new vs modified

2. UI REFINEMENT SUMMARY
- exactly what was improved
- what became visually clearer
- what was intentionally preserved

3. STATUS SYSTEM
- exact state colors/badges/icons used
- where they appear

4. MAP PATH BEHAVIOR
- how movement path rendering works
- how selection/highlight works
- how noise/clutter is prevented

5. ABSENCE ACTION BEHAVIOR
- what actions are visible
- what is actually wired
- what remains UI-only and why

6. AUTHORIZATION / SAFETY
- how role/scope safety was preserved
- confirm no BLE trust was introduced

7. VALIDATION
- typecheck
- build
- manual verification points

8. FOLLOW-UP
- only real remaining UI/product gaps

==================================================
[FINAL EXECUTION INSTRUCTION]
==================================================

First understand the current /counter/monitor implementation.
Then refine it into a premium operator-grade monitoring UI.
Do not rewrite broadly.
Do not guess.
Do not break the current manual-first architecture.