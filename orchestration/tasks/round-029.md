[ROUND]
029

[TASK TYPE]
validator enforcement hardening

[OBJECTIVE]
Enforce NOX orchestration validator rules in executable flow.
Convert current warning-level contract checks into actual PASS/FAIL blocking rules where safe.
Do not modify product API/domain logic.
Only orchestration scripts/rules/docs allowed.

[TARGET FILES]
- C:\work\nox\orchestration\scripts\run-round.ps1
- C:\work\nox\orchestration\rules\NOX_ORCHESTRATION_EXECUTION_RULES.md
- C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[ALLOWED_FILES]
- C:\work\nox\orchestration\scripts\run-round.ps1
- C:\work\nox\orchestration\rules\NOX_ORCHESTRATION_EXECUTION_RULES.md
- C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[FORBIDDEN_FILES]
- C:\work\nox\app\*
- C:\work\nox\lib\*
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js
- C:\work\nox\orchestration\config\state.json

[CONSTRAINTS]
- Product code change forbidden
- Orchestration layer only
- Harden validator behavior from warn-only to enforceable blocking where safe
- Must preserve non-destructive behavior
- Must not claim full autonomous mode
- Must define and align actual executable enforcement with docs/rules
- Must enforce task contract failure on missing required sections:
  - [ROUND]
  - [TASK TYPE]
  - [OBJECTIVE]
  - [TARGET FILE] or [TARGET FILES]
  - [ALLOWED_FILES]
  - [FORBIDDEN_FILES]
  - [CONSTRAINTS]
  - [FAIL IF]
  - [OUTPUT FORMAT]
- Must enforce result contract failure when required sections are missing:
  - FILES CHANGED
  - ROOT CAUSE
  - EXACT DIFF
  - VALIDATION
- Must define/block at least these cases:
  - single-file task but multiple files changed
  - forbidden file modified
  - config file modified
  - allowed file scope violation
  - missing output format
  - empty result file
- run-round.ps1 updates allowed only for:
  - task validation blocking
  - result existence / emptiness checks
  - safer log append
  - clearer FAIL/WARN output
  - no destructive execution
- Docs/rules must clearly distinguish:
  - blockable failures
  - warn-only conditions
  - manual review conditions

[FAIL IF]
- product code modified
- state.json modified
- validator remains warn-only for required contract failures
- docs and executable behavior inconsistent
- destructive behavior added
- autonomous execution claimed without guardrails

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- what enforcement gap existed

EXACT DIFF:
- what was changed in script/rules/spec

VALIDATION:
- task contract enforcement check
- result contract enforcement check
- scope violation blocking check
- empty/malformed result handling check
- no product scope change check
