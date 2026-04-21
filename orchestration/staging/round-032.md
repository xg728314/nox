FILES CHANGED:
- orchestration/scripts/executor-bridge.ps1
- orchestration/scripts/run-round.ps1

ROOT CAUSE:
- overwrite guard 및 single auto-cycle 검증이 필요했음

EXACT DIFF:
- invalid existing result가 차단되는지 확인
- staging file을 통한 auto-save 흐름을 검증

VALIDATION:
- overwrite guard check: PASS
- auto cycle check: PASS
- fallback check: PASS
- no product scope change check: PASS
