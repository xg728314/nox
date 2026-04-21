You are working in the active NOX workspace:

C:\work\nox

This round is BLE READ-ONLY OVERLAY INTEGRATION for Counter Monitoring V2.

==================================================
[OBJECTIVE]
==================================================

Attach BLE presence data to the existing monitoring system as a SAFE, READ-ONLY overlay.

Do NOT modify any business logic.
Do NOT introduce BLE as a source of truth.
Do NOT mutate sessions, participants, time, or settlements.

This round is STRICTLY:
BLE → derived presence → UI overlay

==================================================
[CURRENT STATE]
==================================================

- /counter/monitor UI is complete
- /api/counter/monitor returns derived snapshot
- ble_tag_presence table exists and is populated via secure ingest
- BLE is NOT yet connected to monitoring

==================================================
[REQUIRED IMPLEMENTATION]
==================================================

----------------------------------
1. SERVER: BLE PRESENCE READ
----------------------------------

Modify /api/counter/monitor/route.ts

Add a BLE enrichment step:

- Read ble_tag_presence
- Apply TTL filter:
  last_seen_at > now() - interval '5 minutes'

- Join:
  ble_tag_presence → ble_tags → store_memberships

- Only include rows where:
  membership_id is valid
  and relevant to current store context

----------------------------------
2. ZONE DERIVATION
----------------------------------

Map BLE gateway / presence into zones:

- room
- counter
- restroom
- elevator
- external_floor

Use existing zones.ts mapping.
Do NOT guess coordinates.

----------------------------------
3. RESPONSE SHAPE
----------------------------------

Populate existing response:

ble: {
  confidence: "hybrid",
  presence: [...]
}

Do NOT change the overall response contract.

----------------------------------
4. CLIENT: OVERLAY ONLY
----------------------------------

Modify:

app/counter/monitor/components/*
app/counter/monitor/page.tsx

Rules:

- DO NOT override manual state
- DO NOT move participants automatically
- DO NOT change room assignments

Overlay behavior:

- If BLE zone exists:
  show secondary label (e.g. "BLE: 화장실")
  add subtle visual marker (icon/border)

----------------------------------
5. SUMMARY BAR
----------------------------------

- Update 화장실 / 외부 counts using BLE presence
- Only when ble.confidence === "hybrid"

----------------------------------
6. MODE INDICATOR
----------------------------------

Switch from "manual" → "hybrid"

Update:
- header
- ModeHelpStrip

----------------------------------
7. SAFETY RULES (STRICT)
----------------------------------

FORBIDDEN:

- NO participant creation
- NO participant removal
- NO session creation/close
- NO time segment mutation
- NO settlement mutation

BLE must remain display-only

----------------------------------
8. VALIDATION
----------------------------------

- tsc must pass
- build must pass
- no change to existing counter behavior
- no change to existing API auth rules

==================================================
[OUTPUT FORMAT]
==================================================

1. FILES CHANGED
2. BLE OVERLAY SUMMARY
3. SERVER DATA FLOW
4. CLIENT OVERLAY BEHAVIOR
5. VALIDATION
6. REMAINING RISKS

==================================================
[FINAL RULE]
==================================================

Do not redesign the system.
Do not guess.
Attach BLE safely as an overlay only.