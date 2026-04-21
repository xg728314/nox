---

FILES CHANGED:
- `orchestration/docs/NOX_AUTO_LOOP_SPEC.md`
- `orchestration/rules/NOX_ORCHESTRATION_EXECUTION_RULES.md`
- `orchestration/scripts/run-round.ps1`

ROOT CAUSE:
- Auto-loop stop condition 9.1 (2 consecutive FAILs) had no script-level enforcement — `run-round.ps1` had no mechanism to receive or act on consecutive fail count when called from a loop
- `NOX_AUTO_LOOP_SPEC.md` lacked an explicit lock-date marker, auto-loop entry checklist, and documentation for the `-ConsecutiveFails` parameter
- `NOX_ORCHESTRATION_EXECUTION_RULES.md` had no section defining exit code contract, `ConsecutiveFails` update rules, or loop controller responsibilities

EXACT DIFF:
- **`run-round.ps1`**: Added `[int]$ConsecutiveFails = 0` parameter; added consecutive-fail guard block (exits 1 with log if `>= 2`); added explicit `exit 0` at end
- **`NOX_AUTO_LOOP_SPEC.md`**: Added `LOCKED AS OF ROUND 028` header; expanded Section 3.1 with `-ConsecutiveFails` parameter docs; added Section 11 (Auto-Loop Entry Checklist) covering preconditions, continuation conditions, loop controller responsibilities, and manual stop methods
- **`NOX_ORCHESTRATION_EXECUTION_RULES.md`**: Added `LOCKED AS OF ROUND 028` header; added Section 8 (Auto-Loop Continuation Rules) covering exit code contract, `ConsecutiveFails` update rules, `>= 2` handling, round limit, and semi-auto vs controlled auto-loop mode distinction

VALIDATION:
- **Task contract check**: All 9 required sections present in task file — PASS
- **Result contract check**: All 4 required output sections present — PASS
- **Validator rule check**: All 6 explicit fail conditions documented and enforced in spec + rules; enforcement level classification (BLOCK / WARN→BLOCK / MANUAL_REVIEW) fully defined — PASS
- **Retry/rollback check**: Retry rules (max 1 auto, conditions, fallback to manual) in spec section 7; rollback rules (no auto rollback, git revert, scope) in spec section 8; manual stop methods in spec section 11.4 — PASS
- **No product scope change check**: No files under `app/`, `lib/`, `package.json`, `tsconfig.json`, `next.config.js`, or `state.json` were touched — PASS
