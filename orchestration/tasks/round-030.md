[ROUND]
030

[TASK TYPE]
auto loop trigger integration

[OBJECTIVE]
Connect run-round.ps1 to executor bridge so that task dispatch and result persistence can be automated.
Eliminate manual copy-paste step between task file and executor.
Maintain controlled auto-loop (no full autonomous mode).

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
No product code modification
Only orchestration layer changes
Must introduce executor bridge layer
run-round.ps1 must:
read task file
pass content to executor bridge
receive result
save result automatically
executor-bridge.ps1 must:
accept task content
simulate or integrate executor call interface
return structured result text
Must not introduce unsafe auto execution
Must keep manual override capability
Must define:
task → bridge → executor → result flow
result auto-save path
failure handling if executor returns empty
fallback to manual mode

[FAIL IF]
product code modified
executor call implemented unsafely
result auto-save not implemented
manual override removed
destructive behavior added

[OUTPUT FORMAT]
FILES CHANGED:
path
ROOT CAUSE:
what automation gap existed
EXACT DIFF:
what bridge/flow was added
VALIDATION:
auto dispatch check
result auto save check
fallback check
no product scope change check
