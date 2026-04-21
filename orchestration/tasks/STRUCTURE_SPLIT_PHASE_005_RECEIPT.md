You are executing the next locked NOX structure split task.

Use the latest completed execution results as ground truth:
- Phase 1 completed successfully
- Phase 2 completed successfully
- Phase 3 completed successfully
- Phase 4 completed successfully
- LIVE settlement meaning remains untouched
- dormant settlement system remains untouched
- orders and participants domains were extracted successfully
- auth/store scope semantics remain unchanged
- API paths and response shapes remain unchanged
- validation passed in prior phases:
  - npx tsc --noEmit
  - npm run build

Do not redo earlier phases.
Continue from the current codebase state only.

Current task:
Execute ONLY PHASE 5 — Receipt document builder extraction

Primary target route:
C:\work\nox\app\api\sessions\receipt\route.ts

Primary objective:
Extract the complex receipt document assembly logic from the POST handler into a dedicated receipt domain service, and extract snapshot persistence into a writer helper, while preserving the exact LIVE receipt shape and semantics.

Required target structure:

C:\work\nox\lib\receipt\services\buildReceiptDocument.ts
C:\work\nox\lib\receipt\services\snapshotWriter.ts

You may add a small types file only if clearly needed, but do not create extra abstraction layers without evidence.

Hard rules:
- NO behavior change
- NO snapshot structure change
- NO receipt document shape change
- NO half-ticket calculation rule change
- NO participant name resolution meaning change
- NO settlement meaning change
- NO auth/store scope change
- NO API path change
- NO response shape change
- NO schema change
- DO NOT touch dormant settlement system
- DO NOT broaden into chat/BLE/cross-store
- DO NOT redesign receipt policy
- DO NOT introduce speculative abstractions

Required route end-state:
receipt/route.ts should keep only:
- request parse
- auth / role / scope guard
- session / receipt load orchestration
- owner visibility orchestration
- call to buildReceiptDocument()
- call to snapshotWriter()
- response mapping
- error mapping

Required extraction strategy:

1. buildReceiptDocument.ts
Extract the receipt document assembly logic currently in the POST handler, including only existing LIVE semantics such as:
- participant snapshot assembly
- participant name resolution
- half-ticket mode handling / override behavior
- order snapshot mapping
- final ReceiptDocument composition
- any existing total/field mapping already used in the route

Important:
This is NOT a redesign of receipt output.
Preserve field names, nesting, and meaning exactly.

2. snapshotWriter.ts
Extract receipt snapshot persistence logic, such as:
- snapshot upsert / insert-update flow
- version handling if currently present
- write orchestration around receipt_snapshots
Preserve existing DB write order and failure semantics.

3. Keep tightly-coupled route logic inline if safer
If a small piece is too route-specific and extracting it would risk changing behavior, leave it inline and explain why in the final report.
Prefer safe extraction over forced extraction.

Do NOT do any of the following:
- rename receipt fields
- change participant display name priority rules
- change half-ticket behavior
- change order snapshot structure
- change owner visibility semantics
- change finalized/draft behavior
- refactor unrelated routes
- start Phase 6 work

Validation required before final response:
- npm run tsc --noEmit
- npm run build

Mandatory final report format:

# ROUND XXX — STRUCTURE SPLIT PHASE 5 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what exact logic was moved from receipt/route.ts
- what was placed in buildReceiptDocument.ts
- what was placed in snapshotWriter.ts
- what remained in receipt/route.ts
- any logic intentionally left inline and why

## 3. SAFETY CHECK
- receipt document shape untouched: YES/NO
- snapshot structure untouched: YES/NO
- half-ticket semantics untouched: YES/NO
- participant name resolution untouched: YES/NO
- settlement meaning untouched: YES/NO
- dormant settlement untouched: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL
- runtime smoke: PASS/FAIL/NOT RUN

## 5. ROUTE SIZE IMPACT
- receipt/route.ts before
- receipt/route.ts after
- approximate extracted lines

## 6. REMAINING HOTSPOTS
- next large files still needing split
- unresolved risks
- partial migrations still remaining

## 7. NEXT RECOMMENDED STEP
- Phase 6 recommendation only

If any requirement conflicts with locked existing behavior:
stop and report the exact conflict.
Do not guess.
Do not widen scope.