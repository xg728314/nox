[ROUND]
034

[TASK TYPE]
operational playbook lock

[OBJECTIVE]
Define and lock NOX orchestration operational playbook.
Document how to run Manual, Bridge Assisted, and Controlled Auto-Cycle modes in real usage.
Ensure reproducible execution procedures and clear operator guidance.

[TARGET FILES]
C:\work\nox\orchestration\docs\NOX_OPERATION_PLAYBOOK.md
C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[ALLOWED_FILES]
C:\work\nox\orchestration\docs\NOX_OPERATION_PLAYBOOK.md
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
- Documentation only
- Must define execution procedures for:
  - Manual mode
  - Bridge assisted mode
  - Controlled auto-cycle mode
- Must include:
  - mode selection guide
  - failure handling
  - file path map
  - do/don't rules
- Must provide PowerShell commands for all flows

[FAIL IF]
- execution unclear
- missing commands
- inconsistent with system
- product code modified

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- why playbook was needed

EXACT DIFF:
- what procedures were added

VALIDATION:
- mode clarity check
- execution reproducibility check
- operator usability check
- no product scope change check
