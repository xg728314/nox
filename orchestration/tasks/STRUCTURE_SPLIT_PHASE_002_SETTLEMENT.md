You are executing the next locked NOX structure split task.

First, use the latest Phase 1 execution result as ground truth.
Phase 1 is considered successful and already completed.
Do not redo Phase 1.
Continue from that exact state.

Ground truth from latest execution:
- shared helpers were introduced successfully
- routes were reduced in size
- dormant settlement system was untouched
- settlement formula was untouched
- auth semantics were untouched
- API paths and response shapes were untouched
- validation passed:
  - npx tsc --noEmit
  - npm run build

Current task:
Execute ONLY the next step:
PHASE 2 — Settlement domain boundary extraction

Primary objective:
Extract the LIVE settlement calculation logic out of:

C:\work\nox\app\api\sessions\settlement\route.ts

and move it into a dedicated pure service function.

Target file to create:
C:\work\nox\lib\session\services\settlementCalculator.ts

Hard requirements:
- NO behavior change
- NO settlement formula change
- NO finalize semantics change
- NO auth/store scope change
- NO API path change
- NO response shape change
- DO NOT touch dormant settlement system
- DO NOT import or activate:
  - lib/settlement/computeSessionShares.ts
  - /api/sessions/[session_id]/settlement/*
- NO schema changes
- NO speculative cleanup outside settlement boundary work

Required architecture outcome:
route.ts should become thin and keep only:
- request parse
- auth / role / scope guard
- DB load
- call to settlement calculator
- persistence / snapshot / audit orchestration
- response mapping
- error mapping

settlementCalculator.ts must be:
- pure calculation-focused logic
- no route-specific response building
- no NextResponse inside calculator
- no direct API semantics inside calculator
- no dormant imports
- no unrelated business expansion

Allowed split inside calculator boundary:
You may create small adjacent helpers if truly necessary, but keep scope tight.
Prefer one main calculator service first.

Calculator should contain only the extracted LIVE calculation logic, such as:
- participant flow total calculation
- manager profit total calculation
- hostess profit total calculation
- store revenue total calculation
- store profit total calculation
- negative remainder validation that is part of settlement calculation flow
- any formula-preserving derived totals already present in LIVE route logic

Route should still own:
- auth resolution
- request parsing
- database queries / loads
- write operations
- snapshot persistence
- audit persistence
- final response generation

Important:
This is NOT a formula redesign.
Do NOT "improve" names, logic, or meanings unless strictly required for safe extraction.
This is a preservation extraction.
Copy semantics exactly.

Additional constraints:
- Keep blast radius minimal
- Prefer extraction over rewrites
- Do not broadly refactor receipt/finalize/participants in this round
- Do not expand into Phase 3
- Do not change existing locked business meaning:
  - customer_total
  - participant_flow_total
  - manager_profit_total
  - hostess_profit_total
  - store_revenue_total
  - store_profit_total

Validation required before final response:
- npm run tsc --noEmit
- npm run build

Mandatory final report format:

# ROUND XXX — STRUCTURE SPLIT PHASE 2 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what exact logic was moved from settlement/route.ts
- what remained in route.ts
- whether settlementCalculator is pure or partially impure
- any helper files additionally created

## 3. SAFETY CHECK
- settlement formula untouched: YES/NO
- finalize semantics untouched: YES/NO
- dormant system untouched: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL
- runtime smoke: PASS/FAIL/NOT RUN

## 5. ROUTE SIZE IMPACT
- settlement/route.ts before
- settlement/route.ts after
- approximate extracted lines

## 6. REMAINING HOTSPOTS
- next large files still needing split
- unresolved risks
- partial migrations still remaining

## 7. NEXT RECOMMENDED STEP
- Phase 3 recommendation only

If any requirement conflicts with existing locked behavior:
stop and report exactly where the conflict is.
Do not guess.
Do not widen scope.