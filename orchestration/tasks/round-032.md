[ROUND]
032

[TASK TYPE]
auto cycle validation

[OBJECTIVE]
Validate overwrite guard and single auto-cycle execution using executor bridge.
Ensure that result overwrite is blocked and controlled execution flow is maintained.

[TARGET FILES]
C:\work\nox\orchestration\scripts\run-round.ps1
C:\work\nox\orchestration\scripts\executor-bridge.ps1
C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[ALLOWED_FILES]
C:\work\nox\orchestration\scripts\run-round.ps1
C:\work\nox\orchestration\scripts\executor-bridge.ps1
C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[FORBIDDEN_FILES]
C:\work\nox\app*
C:\work\nox\lib*
C:\work\nox\package.json
C:\work\nox\package-lock.json
C:\work\nox\tsconfig.json
C:\work\nox\next.config.js
C:\work\nox\orchestration\config\state.json

[CONSTRAINTS]
- No product code modification
- Only orchestration layer
- Must verify:
  - existing result file blocks execution
  - result overwrite is prevented
  - single auto cycle works (task → bridge → result)
  - fallback still works if needed

[FAIL IF]
- result overwrite occurs
- existing result not detected
- bridge bypasses validation
- product code modified
- destructive behavior added

[OUTPUT FORMAT]
FILES CHANGED:
path
ROOT CAUSE:
what validation gap existed
EXACT DIFF:
what was validated or fixed
VALIDATION:
overwrite guard check
auto cycle check
fallback check
no product scope change check
