[ROUND]
028

[TASK TYPE]
automation structure lock

[OBJECTIVE]
Prepare NOX orchestration for auto-loop entry.
Lock task generation, executor handoff, result persistence, validator contract, and retry/rollback rules.
No product API feature work.
Automation/documentation/scripts only.

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
- Do not modify product API/domain files
- Do not add business logic
- Only orchestration layer work allowed
- Must define auto-loop spec for:
  - task creation
  - executor handoff
  - result save
  - validator pass/fail
  - retry
  - rollback
  - stop conditions
- Must lock task contract sections:
  - [ROUND]
  - [TASK TYPE]
  - [OBJECTIVE]
  - [TARGET FILE] or [TARGET FILES]
  - [ALLOWED_FILES]
  - [FORBIDDEN_FILES]
  - [CONSTRAINTS]
  - [FAIL IF]
  - [OUTPUT FORMAT]
- Must lock result output:
  - FILES CHANGED
  - ROOT CAUSE
  - EXACT DIFF
  - VALIDATION
- Must explicitly fail on:
  - allowed scope violation
  - forbidden file modification
  - output format missing
  - role/scope contract mismatch
  - multi-file expansion when single-file task
  - config modification
- Must define retry / rollback / manual stop rules
- run-round.ps1 changes allowed only for safer orchestration support
- Must clearly state:
  - current state = semi-automatic
  - target state = controlled auto-loop
  - full autonomous mode not allowed without guardrails

[FAIL IF]
- product code modified
- state.json modified
- auto-loop spec missing retry/rollback
- validator rules incomplete
- task/result contract incomplete
- run-round.ps1 changed destructively
- autonomous execution claimed without guardrails

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- what auto-loop gap existed

EXACT DIFF:
- what contracts/spec/rules were added or updated

VALIDATION:
- task contract check
- result contract check
- validator rule check
- retry/rollback check
- no product scope change check
