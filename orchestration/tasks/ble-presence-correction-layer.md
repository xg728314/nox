You are working in the active NOX workspace:

C:\work\nox

This round is a BLE PRESENCE CORRECTION + ERROR COLLECTION round for /counter/monitor.

This is a critical real-world stabilization round.

==================================================
[OBJECTIVE]
==================================================

Add a human correction layer for BLE location mistakes.

Operators must be able to correct the current BLE-derived location for a worker directly from the monitor UI.

This correction has 2 roles:
1. immediately fix the current monitor display
2. accumulate correction data for later BLE accuracy analysis

BLE remains read-only as an original signal source.
Human correction is an overlay, not a destructive rewrite of raw BLE history.

==================================================
[WHY THIS EXISTS]
==================================================

BLE testing will take time.
One person cannot validate all movement and location accuracy alone.

Real operators in the field must be able to:
- notice BLE misclassification
- correct the visible location immediately
- leave behind a trace of that correction
- help the system become more accurate over time

Example:
- BLE says: restroom
- real location: 8F party room 1
Operator must be able to correct that directly from the monitor.

==================================================
[STRICT RULES]
==================================================

- Do NOT delete or overwrite raw BLE data
- Do NOT let BLE correction mutate settlement logic
- Do NOT let BLE correction mutate /counter transactional logic
- Do NOT auto-apply business state changes from correction
- Correction is for monitor display + analysis data
- Preserve all existing auth/store scope rules
- Keep implementation additive

==================================================
[REQUIRED IMPLEMENTATION]
==================================================

----------------------------------
1. DB TABLE
----------------------------------

Create a new table:

ble_presence_corrections

Columns:
- id uuid pk default gen_random_uuid()
- store_uuid uuid not null references stores(id)
- membership_id uuid not null references store_memberships(id)
- session_id uuid null references room_sessions(id)
- participant_id uuid null references session_participants(id)
- original_zone text not null
- corrected_zone text not null
- original_room_uuid uuid null references rooms(id)
- corrected_room_uuid uuid null references rooms(id)
- ble_presence_seen_at timestamptz null
- corrected_by_membership_id uuid not null references store_memberships(id)
- corrected_at timestamptz not null default now()
- gateway_id text null
- reason text null
- note text null
- is_active boolean not null default true

Indexes:
- (store_uuid, membership_id, corrected_at desc)
- (store_uuid, participant_id, corrected_at desc)
- (store_uuid, is_active, corrected_at desc)

Purpose:
- append correction history
- allow latest active correction lookup
- support future analytics

----------------------------------
2. SERVER API
----------------------------------

Create a new route:

POST /api/ble/corrections

Body:
{
  membership_id: string,
  participant_id?: string,
  session_id?: string,
  original_zone: string,
  corrected_zone: string,
  original_room_uuid?: string | null,
  corrected_room_uuid?: string | null,
  ble_presence_seen_at?: string | null,
  gateway_id?: string | null,
  reason?: string,
  note?: string
}

Rules:
- resolveAuthContext
- role must be owner or manager
- store_uuid required and enforced
- membership_id must belong to a worker visible in current store context
- participant/session linkage must match current store if provided
- validate corrected_zone enum:
  - room
  - counter
  - restroom
  - elevator
  - external_floor
- if corrected_zone === "room", corrected_room_uuid required
- if corrected_zone !== "room", corrected_room_uuid must be null

Insert one correction row.
Do NOT mutate BLE raw tables.

Return:
{
  ok: true,
  correction_id,
  applied_overlay: {
    membership_id,
    corrected_zone,
    corrected_room_uuid
  }
}

----------------------------------
3. MONITOR READ MODEL INTEGRATION
----------------------------------

Modify /api/counter/monitor/route.ts

Current logic already derives BLE overlay.
Now add correction overlay precedence:

For each membership:
- check latest active correction row in current store context
- if found, use corrected zone/room for monitor display
- raw BLE stays available internally, but corrected overlay wins for UI

Important:
- correction only affects monitor presentation
- do NOT alter raw ble.presence source rows
- response should expose enough info so the client can show:
  - corrected location
  - "수정됨" / correction badge if appropriate

Recommended additive fields on ble.presence item:
- source: "ble" | "corrected"
- corrected_by_membership_id?: string
- corrected_at?: string

----------------------------------
4. CLIENT UI
----------------------------------

Extend the existing participant action surface.

When operator clicks a worker/avatar/participant row:
Existing action popover already exists.

Add a new action:
[위치 수정]

When clicked:
open a correction modal/panel.

Show:
- current BLE / current displayed location
- choose actual location:
  - 방
    - current store room list
  - 카운터
  - 화장실
  - 엘리베이터
  - 외부
- optional reason
  - 화장실 오탐
  - 카운터 오탐
  - 엘베 오탐
  - 타층 오탐
  - 복귀 반영 늦음
  - 기타
- optional note

Buttons:
[취소]
[저장]

On success:
- close modal
- refresh monitor snapshot immediately
- current UI should now reflect corrected location
- show small confirmation message

----------------------------------
5. UI DISPLAY RULES
----------------------------------

If a correction is active:
- monitor should display corrected zone instead of raw BLE-derived zone
- show a subtle badge such as:
  - 수정됨
  - BLE 수정
- do NOT hide the fact that this was corrected
- manual session/participant state remains primary
- correction only affects location overlay

Examples:
- 기존: 이탈 (BLE: 화장실)
- 수정 후: 이탈 (수정: 파티 1번방)

Map:
- corrected zone/room should determine where the marker is rendered
- do NOT render both raw and corrected markers at the same time

----------------------------------
6. CORRECTION LIFETIME
----------------------------------

Correction must not become permanent truth forever.

Initial rule:
- correction remains active only while relevant current context remains active
- if participant/session ends, correction stops affecting active monitor display
- history row remains in DB for analysis

Implementation may use:
- latest correction lookup scoped to currently visible participants/sessions
- no need to build a cleanup job in this round unless necessary

----------------------------------
7. SAFETY
----------------------------------

- owner/manager only
- store_uuid enforced
- no settlement mutation
- no session mutation
- no participant mutation
- no BLE raw overwrite
- correction is overlay only
- all writes auditable through the correction table itself

----------------------------------
8. OPTIONAL BUT GOOD IF CLEAN
----------------------------------

If easy and safe, add a small derived indicator in the monitor UI:
- corrected count
- or a filter badge for "수정됨"

Do not overbuild analytics UI in this round.
That is a later phase.

==================================================
[OUTPUT FORMAT]
==================================================

Return ONLY in this format:

1. FILES CHANGED
- exact paths
- new vs modified

2. CORRECTION FLOW SUMMARY
- how correction is created
- how it affects the monitor

3. API DESIGN
- route behavior
- validation and auth

4. DATA MODEL
- ble_presence_corrections shape
- indexes
- lifetime behavior

5. CLIENT BEHAVIOR
- where the operator clicks
- how correction UI works
- how corrected state is shown

6. SAFETY CONFIRMATION
- confirm no business mutation
- confirm no BLE raw overwrite
- confirm store scope/auth preserved

7. VALIDATION
- typecheck
- build
- manual verification steps

8. NEXT BEST STEP
- the next round only

==================================================
[FINAL RULE]
==================================================

This round is about human correction of BLE mistakes.
Do not redesign the whole monitor.
Do not automate business decisions.
Do not overwrite raw BLE data.
Keep it additive, safe, and field-usable.