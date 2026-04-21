[ROUND]
033

[TASK TYPE]
operational control lock

[OBJECTIVE]
Lock operational safety controls for NOX controlled automation.
Define repeat-run limits, stop conditions, manual override rules, and execution profile boundaries.
Do not modify product API/domain logic.
Only orchestration control layer allowed.

[TARGET FILES]
- C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md
- C:\work\nox\orchestration\rules\NOX_ORCHESTRATION_EXECUTION_RULES.md
- C:\work\nox\orchestration\scripts\run-round.ps1

[ALLOWED_FILES]
- C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md
- C:\work\nox\orchestration\rules\NOX_ORCHESTRATION_EXECUTION_RULES.md
- C:\work\nox\orchestration\scripts\run-round.ps1

[FORBIDDEN_FILES]
- C:\work\nox\app\*
- C:\work\nox\lib\*
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js
- C:\work\nox\orchestration\config\state.json

[CONSTRAINTS]
- No product code modification
- Orchestration control layer only
- Must lock operational control rules for controlled automation
- Must define:
  - max consecutive auto runs
  - mandatory stop conditions
  - manual override entry conditions
  - manual override exit conditions
  - safe failure handling
  - logging expectations
  - allowed bridge modes per operating profile
- Must clearly separate:
  - manual mode
  - controlled bridge mode
  - controlled auto-cycle mode
  - full autonomous mode = prohibited
- Must not introduce unrestricted autonomous looping
- If run-round.ps1 is changed, keep changes minimal and non-destructive
- Must preserve overwrite guard and result contract enforcement
- Must define stop conditions at minimum for:
  - repeated bridge failure
  - repeated malformed result
  - forbidden file detection
  - scope violation
  - missing required task sections
  - missing required result sections
  - manual operator stop
  - max auto-run threshold reached

[FAIL IF]
- product code modified
- unrestricted loop added
- stop conditions incomplete
- manual override rules incomplete
- docs and executable behavior inconsistent
- destructive behavior added

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- what operational control gap existed

EXACT DIFF:
- what control rules/spec/script behavior were added or updated

VALIDATION:
- stop condition check
- run limit check
- manual override check
- profile separation check
- no product scope change check