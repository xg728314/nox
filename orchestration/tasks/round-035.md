[ROUND]
035

[TASK TYPE]
final operational handoff lock

[OBJECTIVE]
Lock the final NOX operational handoff document based on rounds 025 through 034.
Create a single final handoff reference for restart, transfer, and daily operation.
Documentation only. No product code changes.

[TARGET FILES]
- C:\work\nox\orchestration\handoff\NOX_OPERATION_FINAL_HANDOFF.md
- C:\work\nox\orchestration\docs\NOX_OPERATION_PLAYBOOK.md
- C:\work\nox\orchestration\docs\NOX_AUTO_LOOP_SPEC.md

[ALLOWED_FILES]
- C:\work\nox\orchestration\handoff\NOX_OPERATION_FINAL_HANDOFF.md
- C:\work\nox\orchestration\docs\NOX_OPERATION_PLAYBOOK.md
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
- Documentation only
- No product code modification
- Must create final handoff document as the single top-level operator reference
- Must reflect actual locked state from rounds 025 to 034 only
- Must not claim full autonomous mode
- Must clearly state controlled automation only

The final handoff must include at minimum:

1. CURRENT SYSTEM STATUS
- controlled automation operational
- full autonomous prohibited
- latest validated round range

2. ROUND SUMMARY
- 025 manager settlement summary
- 026 owner settlement overview
- 027 settlement doc/handoff lock
- 028 auto-loop structure lock
- 029 validator enforcement hardening
- 030 executor bridge integration
- 031 bridge real-operation validation
- 032 overwrite guard and single auto-cycle validation
- 033 operational control lock
- 034 operation playbook lock

3. OPERATION MODES
- Manual
- Bridge Assisted
- Controlled Auto-Cycle
- Full Autonomous = prohibited

4. FILE PATH MAP
- tasks
- results
- staging
- logs
- rules
- docs
- handoff

5. OPERATOR START PROCEDURE
- where to begin
- which file to open first
- how to run standard round
- how to run bridge-assisted round

6. FAILURE RESPONSE
- bridge failure
- malformed result
- overwrite block
- missing staged result
- validator fail

7. LOCKED SAFETY RULES
- overwrite guard required
- result contract required
- forbidden file protection
- product scope isolation
- stop conditions and manual override apply

8. NEXT RECOMMENDED ACTION
- resume product rounds only after reviewing final handoff
- use playbook + auto loop spec together

Also update playbook/spec only if needed for alignment with final handoff wording.

[FAIL IF]
- product code modified
- final handoff missing round summary
- final handoff missing operation modes
- final handoff missing path map
- autonomous mode described as allowed
- docs inconsistent with locked system state

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- why final handoff lock was needed

EXACT DIFF:
- what final handoff sections were added or aligned

VALIDATION:
- final handoff completeness check
- round alignment check
- operating mode check
- no product scope change check