You are executing the next locked NOX structure split task.

Use the latest completed execution results as ground truth:
- Phase 1 completed successfully
- Phase 2 completed successfully
- Phase 3 completed successfully
- LIVE settlement domain remains untouched in meaning
- dormant settlement system remains untouched
- orders domain was extracted successfully
- auth/store scope semantics remain unchanged
- API paths and response shapes remain unchanged
- validation passed in prior phases:
  - npx tsc --noEmit
  - npm run build

Do not redo earlier phases.
Continue from the current codebase state only.

Current task:
Execute ONLY PHASE 4 — Participant action boundary extraction

Primary target routes:
C:\work\nox\app\api\sessions\participants\[participant_id]\route.ts
C:\work\nox\app\api\sessions\participants\route.ts

Primary objective:
Extract the 9-action PATCH logic from participants/[participant_id]/route.ts into action-specific service files, and extract shared pricing lookup logic used across participant mutation/registration flows.

Required target structure:

C:\work\nox\lib\session\services\participantActions\
  applyCha3.ts
  applyBanti.ts
  applyWanti.ts
  updateCategory.ts
  updateDeduction.ts
  toggleWaiterTip.ts
  fillUnspecified.ts
  updateTimeOrPrice.ts
  updateExternalName.ts

C:\work\nox\lib\session\services\pricingLookup.ts
C:\work\nox\lib\session\validators\participantValidation.ts

You may slightly adjust names only if the current code proves a different naming is safer, but preserve the boundary intent exactly.

Hard rules:
- NO behavior change
- NO pricing rule change
- NO time calculation rule change
- NO settlement meaning change
- NO participant state meaning change
- NO auth/store scope change
- NO API path change
- NO response shape change
- NO schema change
- DO NOT touch dormant settlement system
- DO NOT broaden into receipt/chat/BLE
- DO NOT redesign participant policy
- DO NOT merge all actions into one giant participantService.ts
- DO NOT introduce speculative abstractions

Required route end-state:
participants/[participant_id]/route.ts should keep only:
- request parse
- auth / role / scope guard
- participant/session load orchestration
- switch/action dispatch
- response mapping
- error mapping

participants/route.ts should keep only:
- request parse
- auth / role / scope guard
- registration orchestration
- pricing lookup entry
- DB write orchestration
- response mapping
- error mapping

Required extraction strategy:

1. Action-specific service extraction
Each action branch in participants/[participant_id]/route.ts must be moved to its own service file.
Expected action classes include existing LIVE branches such as:
- cha3
- banti
- wanti
- category change
- deduction update
- waiter tip toggle
- unspecified fill
- time/price edit
- external name update

Important:
Use the actual existing action names from the code.
Do not invent or rename business actions unless strictly necessary for safe extraction.

2. pricingLookup.ts
Extract duplicated store_service_types / pricing-resolution logic shared across:
- participants POST registration flow
- participant PATCH category-related flow
- unspecified fill flow
Keep semantics identical.

3. participantValidation.ts
Extract shared validation only if already duplicated and stable, such as:
- category / time_type validation
- required field guards
- editability guards
- boundary conditions already present in LIVE code
Do not create a broad validation framework.

4. Preserve DB writes where safest
If an action file can safely own its DB mutation logic without changing semantics, that is allowed.
If not, route may keep some orchestration while action service returns update payloads.
Choose the safer option with minimal semantic risk.

Architecture rules:
- one action = one file
- no all-in-one participant service
- common pricing logic separate
- common validation separate only if safe
- route should become dispatcher/orchestrator, not business engine

Do NOT do any of the following:
- rewrite time logic
- rewrite pricing logic
- unify actions by force
- redesign request payloads
- change response messages or status codes
- refactor unrelated session routes
- start receipt split in this round

Validation required before final response:
- npm run tsc --noEmit
- npm run build

Mandatory final report format:

# ROUND XXX — STRUCTURE SPLIT PHASE 4 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what exact actions were extracted
- what was placed in each action file
- what was placed in pricingLookup.ts
- what was placed in participantValidation.ts
- what remained in routes
- any action branches intentionally left inline and why

## 3. SAFETY CHECK
- participant action semantics untouched: YES/NO
- pricing rules untouched: YES/NO
- time calculation rules untouched: YES/NO
- settlement meaning untouched: YES/NO
- dormant settlement untouched: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL
- runtime smoke: PASS/FAIL/NOT RUN

## 5. ROUTE SIZE IMPACT
- participants/[participant_id]/route.ts before
- participants/[participant_id]/route.ts after
- participants/route.ts before
- participants/route.ts after
- approximate extracted lines

## 6. REMAINING HOTSPOTS
- next large files still needing split
- unresolved risks
- partial migrations still remaining

## 7. NEXT RECOMMENDED STEP
- Phase 5 recommendation only

If any requirement conflicts with locked existing behavior:
stop and report the exact conflict.
Do not guess.
Do not widen scope.