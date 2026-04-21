[ROUND]
027

[TASK TYPE]
documentation lock

[OBJECTIVE]
Lock current NOX system state after round-025 and round-026.
Update settlement visibility rules with implemented 3-layer status.
Create current handoff document.
Documentation only. No code changes.

[TARGET FILES]
- C:\work\nox\orchestration\rules\NOX_SETTLEMENT_VISIBILITY_RULES.md
- C:\work\nox\orchestration\handoff\NOX_CURRENT_HANDOFF.md

[ALLOWED_FILES]
- C:\work\nox\orchestration\rules\NOX_SETTLEMENT_VISIBILITY_RULES.md
- C:\work\nox\orchestration\handoff\NOX_CURRENT_HANDOFF.md

[FORBIDDEN_FILES]
- C:\work\nox\app\*
- C:\work\nox\lib\*
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\package.json
- C:\work\nox\tsconfig.json

[CONSTRAINTS]
- Documentation only
- No code changes
- Must document 3-layer settlement visibility:
  - /api/me/settlement-status
  - /api/manager/settlement/summary
  - /api/store/settlement/overview
- Must explicitly document self -> assigned -> store expansion order
- Must keep payout/price/calculation/detail as not implemented / prohibited
- Must create handoff with:
  - SYSTEM STATE
  - SETTLEMENT VISIBILITY MATRIX
  - IMPLEMENTED ROUTES
  - NOT IMPLEMENTED
  - NEXT STEP

[FAIL IF]
- code file modified
- settlement rules incomplete
- 3-layer structure missing
- payout/detail marked as implemented
- document inconsistent with actual routes

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- why doc update was needed

EXACT DIFF:
- what sections added/updated

VALIDATION:
- 3-layer structure check
- route alignment check
- prohibited fields exclusion check
