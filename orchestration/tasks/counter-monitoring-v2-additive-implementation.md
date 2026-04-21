You are working in the active NOX workspace:

C:\work\nox

This round is NOT a rewrite.
This round is a controlled additive UI/architecture implementation.

==================================================
[OBJECTIVE]
==================================================

Create a new "Counter Monitoring V2" screen that matches the provided dashboard direction:

- keep the current counter workflow alive
- do NOT replace the current counter page
- add a new monitoring-oriented layout beside the existing manual workflow
- manual operation must remain fully usable
- BLE is NOT the primary source yet
- initial implementation must work with manual / derived data first
- future BLE data must be attachable later without redesign

This screen is for operational visibility, not for replacing the existing transactional counter UI.

==================================================
[TOP-LEVEL PRODUCT RULES — LOCKED]
==================================================

1. Existing counter workflow must remain usable
2. Existing pages/components should be reused where reasonable, not discarded
3. Manual mode remains first-class
4. BLE mode is additive and must not break manual mode
5. UI hidden = API blocked
6. store_uuid is the only security scope
7. room_uuid is room identity
8. room_no is display only
9. session_id is runtime identity
10. Foreign-store workers must only be visible in the current store while actively working in a current active session
11. After that active session ends, foreign-store workers must disappear from unrelated visibility panels
12. Home-store owner/manager visibility must be separated from current-working-store visibility
13. This round is UI + client integration + safe derived server read model only
14. This round must NOT introduce direct BLE trust into settlement/session writes
15. Do NOT degrade the existing counter page

==================================================
[REQUIRED IMPLEMENTATION GOAL]
==================================================

Build a new monitoring layout screen that visually matches this product direction:

A. Left panel
- current room list / room cards
- keep compatibility with existing counter room UI
- each room card should show current participants and derived state tags when available

B. Top summary bar
- counts for:
  - 재실
  - 이탈
  - 화장실
  - 외부(타층)
  - 대기

C. Center panel
- mini-map / zone view
- floor tabs:
  - 5F
  - 6F
  - 7F
  - 8F
  - 전체층
- zone-based rendering, NOT GPS-like coordinates
- visual blocks for:
  - rooms
  - counter zones
  - restroom
  - elevator
- avatar/icon markers rendered by current derived zone

D. Right panel 1
- "마블 소속 아가씨 위치 현황" style panel
- for current store owner/manager:
  show home-store workers across floors/stores according to visibility policy

E. Right panel 2
- "다른 가게 아가씨 (진행중인 방만)" style panel
- show foreign workers only while they are actively participating in current store active sessions
- once session ends, remove them immediately from this panel

F. Lower panel
- recent movement events
- alerts / action area
- actions are visual for now; do NOT connect dangerous write automation from BLE

G. Mode area
- AUTO / MANUAL concept can exist visually
- but this round remains manual-first
- indicate that manual input remains supported

==================================================
[VERY IMPORTANT IMPLEMENTATION STRATEGY]
==================================================

This must be implemented in phases INSIDE THIS ROUND, in this exact order:

PHASE 1 — Build the new UI shell using mock/derived data
PHASE 2 — Connect existing live manual session/participant data
PHASE 3 — Introduce derived zone/presence read model WITHOUT BLE trust
PHASE 4 — Prepare clean attachment points for future BLE read-only overlay

Do NOT jump directly to BLE integration.
Do NOT implement participant auto-creation from BLE.
Do NOT implement BLE-driven session state mutation.
Do NOT implement fake automation.

==================================================
[VISIBILITY POLICY — MUST IMPLEMENT CAREFULLY]
==================================================

You must encode these policies clearly in code comments and logic:

1. Current store owner/manager can see:
- active rooms in current store
- current-store operational state
- home-store workers' current working location summary across floors/stores (policy-controlled)

2. Foreign-store workers are visible in current store ONLY IF:
- they are part of an active current-store session
- and visibility is being rendered from the working-store operational context

3. Once the current-store session ends:
- remove foreign worker from current-store monitoring panels
- do not keep stale visibility

4. Do NOT expose unrelated foreign-store internals
- only show what is necessary for the active operational context

5. "전체층" view must remain policy-safe
- do not leak full store internals
- show zone/store summary only as allowed

==================================================
[DATA / ARCHITECTURE RULES]
==================================================

1. Reuse current room/session/participant structures where possible
2. Add new derived read-model helpers/hooks if needed
3. Prefer additive hooks/selectors over invasive rewrites
4. If a lightweight server-side read endpoint is needed for monitoring, it must:
   - enforce role
   - enforce store_uuid
   - enforce visibility rules
   - return only safe derived data
5. Do NOT trust client-side visibility filtering alone
6. Do NOT use BLE tables as authoritative source for business writes
7. The UI may contain placeholders/stubs for future BLE overlay
8. Manual mode must remain fully usable even if monitoring data is incomplete

==================================================
[DESIGN / UX REQUIREMENTS]
==================================================

The result should feel premium and operationally sharp.

Requirements:
- dark high-clarity monitoring layout
- zone-based visual rendering
- clear floor tabs
- fast glanceability
- room cards remain readable
- status colors/tags must be obvious
- movement/event area must be clean, not noisy
- do not create a cluttered "map"
- use blocks/zones, not precise coordinates
- emphasize operational confidence over decorative effects

This is a monitoring dashboard, not a toy animation.

==================================================
[FILES / AREAS TO INSPECT BEFORE IMPLEMENTING]
==================================================

Inspect and reuse where relevant:
- current counter page and room card components
- counter layout / customization system
- preferencesStore
- useRoomLayout
- useMenuConfig
- role/menu filtering
- auth helpers
- any existing dashboard/store/session participant read paths
- current live session state
- any existing BLE route files only for future-safe attachment planning, NOT for trust-based implementation

==================================================
[HARD CONSTRAINTS]
==================================================

- Do NOT break build
- Do NOT break typecheck
- Do NOT delete existing counter workflow
- Do NOT silently change settlement logic
- Do NOT create a fake fully-automated BLE workflow
- Do NOT bypass authorization for convenience
- Do NOT expose foreign workers after session end
- Do NOT create full-floor data leakage in "전체층" mode
- Do NOT move existing working logic unless necessary
- Prefer additive implementation

==================================================
[IF NEW SERVER ENDPOINTS ARE NEEDED]
==================================================

If you add a monitoring endpoint, it must:
- use resolveAuthContext
- reject unauthorized roles
- enforce store scope
- return derived/policy-safe visibility data only
- not write mutable business state
- not depend on raw client claims
- be safe for future BLE overlay attachment

==================================================
[OUTPUT FORMAT]
==================================================

Return ONLY in this format:

1. FILES CHANGED
- exact paths
- new vs modified

2. IMPLEMENTATION SUMMARY
- what was built
- what was reused
- what was intentionally NOT changed

3. VISIBILITY POLICY IMPLEMENTED
- exact policy behavior for:
  - current store workers
  - home-store workers
  - foreign-store workers
  - session-end cleanup behavior in UI/read model

4. DATA FLOW
- how the new monitoring screen gets its data today
- how future BLE can attach later without redesign

5. VALIDATION
- typecheck
- build
- manual verification points

6. FOLLOW-UP RISKS / NEXT STEP
- only real remaining items

==================================================
[FINAL EXECUTION INSTRUCTION]
==================================================

Read the current codebase first.
Understand the existing counter/customization/auth structure first.
Then implement the new Counter Monitoring V2 screen additively and safely.
No guessing.
No broad rewrites.