You are working in the active NOX workspace:

C:\work\nox

This round is CRITICAL SECURITY PATCHING for BLE readiness.

==================================================
[OBJECTIVE]
==================================================

Fix the BLE ingest pipeline so it becomes a TRUSTED INPUT SOURCE.

Currently BLE ingest is insecure and unsafe for future integration.

This round must implement P0-level fixes ONLY.

NO feature work.
NO UI work.
NO refactor beyond what is required for security.

==================================================
[CRITICAL CONTEXT]
==================================================

NOX is currently manual-first.

BLE is NOT yet trusted.
BLE will later be used ONLY as a read overlay.

BUT:
If BLE ingest is not secured NOW,
future integration will corrupt:

- participant tracking
- time tracking
- settlement logic

==================================================
[REQUIRED FIXES — MUST IMPLEMENT ALL]
==================================================

----------------------------------
1. HMAC AUTHENTICATION
----------------------------------

Replace current gateway authentication:

FROM:
- x-gateway-key = gateway_secret

TO:
- x-gateway-id
- x-gateway-signature

Signature rule:

signature = HMAC_SHA256(raw_body, gateway_secret)

Server must:

1. lookup gateway by gateway_id
2. compute HMAC with stored gateway_secret
3. compare with x-gateway-signature
4. reject if mismatch

----------------------------------
2. TIMESTAMP VALIDATION
----------------------------------

Validate observed_at for each event:

Rules:

- must not be in future (now + 30s max)
- must not be older than 5 minutes

Reject request if any event fails

----------------------------------
3. EVENT BATCH LIMIT
----------------------------------

Add strict limit:

events.length <= 200

If exceeded:
→ return 413

----------------------------------
4. EVENT SCHEMA VALIDATION
----------------------------------

Validate each event:

- beacon_minor must be integer
- event_type must be in enum:
  ["enter","exit","heartbeat"]

- RSSI must be within reasonable range (-120 ~ 0)

Reject malformed payload

----------------------------------
5. DEDUPLICATION
----------------------------------

Before writing:

Deduplicate by:

(gateway_id, beacon_minor, observed_at, event_type)

Prevent replay injection

----------------------------------
6. BLE AUDIT TABLE (MANDATORY)
----------------------------------

Create new table:

ble_ingest_audit

Columns:

- id
- store_uuid
- gateway_id
- received_at
- event_count
- success (boolean)
- error_message (nullable)
- raw_hash (optional)

Do NOT use audit_events table (FK mismatch problem)

Insert one audit row per request

----------------------------------
7. ERROR HANDLING
----------------------------------

DO NOT silently fail

If any DB insert fails:
- log error
- return 500

Audit write failure must be visible

----------------------------------
8. RATE LIMIT (MINIMUM)
----------------------------------

Implement simple protection:

- max 10 requests per second per gateway

(keep simple — in-memory or DB counter acceptable)

----------------------------------
9. DO NOT CHANGE BUSINESS LOGIC
----------------------------------

STRICTLY FORBIDDEN:

- do NOT create participants
- do NOT modify sessions
- do NOT modify time segments
- do NOT connect BLE to settlement
- do NOT trust BLE as source of truth

This round is INPUT HARDENING ONLY

==================================================
[FILES TO MODIFY]
==================================================

- app/api/ble/ingest/route.ts
- database schema (new table)
- any helper needed for HMAC validation

DO NOT touch:

- monitor UI
- counter
- session logic
- participant logic

==================================================
[OUTPUT FORMAT]
==================================================

1. FILES CHANGED
2. SECURITY FIX SUMMARY
3. BEFORE / AFTER COMPARISON
4. VALIDATION (tsc/build)
5. REMAINING RISKS

==================================================
[FINAL RULE]
==================================================

NO GUESSING
NO PARTIAL IMPLEMENTATION

If any fix is incomplete → FAIL

Implement full secure ingest pipeline