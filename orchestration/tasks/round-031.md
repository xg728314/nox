[ROUND]
031

[TASK TYPE]
bridge operation validation

[OBJECTIVE]
Validate executor bridge real operation for NOX orchestration.
Test clipboard mode and file mode result persistence flow safely.
Do not modify product API/domain logic.
Allow only orchestration validation changes if strictly necessary.

[TARGET FILES]
C:\work\nox\orchestration\scripts\executor-bridge.ps1
C:\work\nox\orchestration\scripts\run-round.ps1
C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[ALLOWED_FILES]
C:\work\nox\orchestration\scripts\executor-bridge.ps1
C:\work\nox\orchestration\scripts\run-round.ps1
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
- Orchestration layer only
- Validate bridge real usage for:
  - clipboard mode
  - file mode
- Must verify:
  - result contract validation works
  - auto-save works
  - existing result guard works
  - fallback to manual works
- If code change is needed, keep it minimal and only for orchestration validation safety
- Must document exact execution procedure for clipboard mode and file mode
- Must not introduce autonomous looping yet
- Must cover:
  - successful clipboard result save path
  - successful file-mode result save path
  - malformed result rejection
  - empty result rejection
  - existing result overwrite prevention
  - manual fallback behavior

[FAIL IF]
- product code modified
- autonomous loop introduced
- result overwrite allowed unsafely
- malformed result accepted
- docs and script behavior inconsistent
- destructive behavior added

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- what bridge validation gap existed

EXACT DIFF:
- what validation logic or documentation was added/updated

VALIDATION:
- clipboard mode check
- file mode check
- malformed result rejection check
- overwrite guard check
- fallback check
- no product scope change check
