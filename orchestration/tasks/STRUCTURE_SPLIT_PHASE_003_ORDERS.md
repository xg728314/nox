You are executing the next locked NOX structure split task.

First use the latest completed execution result as ground truth:
- Phase 1 completed successfully
- Phase 2 completed successfully
- LIVE settlement calculation was extracted into a pure service
- dormant settlement system remains untouched
- auth/store scope semantics remain unchanged
- API paths and response shapes remain unchanged
- validation passed:
  - npx tsc --noEmit
  - npm run build

Do not redo earlier phases.
Continue from the current codebase state only.

Current task:
Execute ONLY PHASE 3 — Order / Inventory domain boundary extraction

Target routes:
C:\work\nox\app\api\sessions\orders\route.ts
C:\work\nox\app\api\sessions\orders\[order_id]\route.ts

Primary objective:
Extract order validation, inventory mutation logic, and shared order domain types out of the routes so the routes become thin orchestration controllers.

Required target structure:
C:\work\nox\lib\orders\
  services\
    validateOrder.ts
    inventoryOps.ts
    orderMutations.ts
  types.ts

You may adjust file count slightly if needed, but keep the above boundary intent.

Hard rules:
- NO behavior change
- NO pricing rule change
- NO inventory semantics change
- NO audit meaning change
- NO auth/store scope change
- NO API path change
- NO response shape change
- NO schema change
- DO NOT touch dormant settlement system
- DO NOT broaden into participants/receipt/chat
- DO NOT redesign order policy
- DO NOT introduce speculative abstractions

Required route end-state:
Routes should keep only:
- request parse
- auth / role / scope guard
- input validation entry
- query/load orchestration
- service calls
- response mapping
- error mapping

Extractable units:

1. validateOrder.ts
Should contain only validation/business-rule-preserving checks already present in LIVE routes, such as:
- required field validation
- quantity validation
- price validation
- sale/deposit/minimum guard logic if already present
- invalid mutation-state checks if already present
Do not invent new pricing policy.

2. inventoryOps.ts
Should contain shared inventory stock mutation logic already duplicated across create/delete/update flows, such as:
- decrement stock on create
- restore stock on delete
- reverse/reapply behavior on updates if already present
Must preserve current atomic behavior and failure semantics.

3. orderMutations.ts
Should contain shared order-domain write orchestration if duplication exists, such as:
- create order row
- update order row
- delete order row
- mutation helper steps tightly coupled to order persistence
Keep scope limited to order domain.

4. types.ts
Move shared LIVE order-related types here if currently duplicated inline.

Important:
This is a preservation extraction, not a redesign.
Keep logic semantically identical.
Prefer moving existing code with minimal transformation.

Do NOT do any of the following:
- change price formulas
- change stock rollback semantics
- change receipt-finalized protections
- change business day behavior
- change store_uuid filtering semantics
- change audit payload meaning
- refactor unrelated session routes
- start Phase 4 work

Validation required before final response:
- npm run tsc --noEmit
- npm run build

Mandatory final report format:

# ROUND XXX — STRUCTURE SPLIT PHASE 3 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what exact logic was moved from orders routes
- what remained in routes
- what was placed in validateOrder.ts
- what was placed in inventoryOps.ts
- what was placed in orderMutations.ts
- any additional helper/type files created

## 3. SAFETY CHECK
- pricing rules untouched: YES/NO
- inventory semantics untouched: YES/NO
- audit meaning untouched: YES/NO
- dormant settlement untouched: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL
- runtime smoke: PASS/FAIL/NOT RUN

## 5. ROUTE SIZE IMPACT
- orders/route.ts before
- orders/route.ts after
- orders/[order_id]/route.ts before
- orders/[order_id]/route.ts after
- approximate extracted lines

## 6. REMAINING HOTSPOTS
- next large files still needing split
- unresolved risks
- partial migrations still remaining

## 7. NEXT RECOMMENDED STEP
- Phase 4 recommendation only

If any requirement conflicts with locked existing behavior:
stop and report the exact conflict.
Do not guess.
Do not widen scope.