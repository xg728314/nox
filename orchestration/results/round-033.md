FILES CHANGED:
- orchestration/docs/NOX_AUTO_LOOP_SPEC.md
- orchestration/rules/NOX_ORCHESTRATION_EXECUTION_RULES.md
- orchestration/scripts/run-round.ps1

ROOT CAUSE:
- controlled automation 운영 단계에 들어왔지만, 반복 실행 한도, stop 조건, manual override 규칙, operating profile 경계가 완전히 잠기지 않았음
- 현재는 bridge/validator는 동작하나 운영 제어 기준이 문서와 실행 흐름에서 더 명확히 고정될 필요가 있었음

EXACT DIFF:
- NOX_AUTO_LOOP_SPEC.md: 운영 프로파일(Manual / Bridge Assisted / Controlled Auto-Cycle / Full Autonomous prohibited), 최대 연속 실행 수, stop 조건, manual override 진입/종료 조건 반영
- NOX_ORCHESTRATION_EXECUTION_RULES.md: stop 조건, safe failure handling, logging expectations, allowed bridge modes per profile 반영
- run-round.ps1: 운영 제어 관련 출력 또는 최소 비파괴 보강만 적용, overwrite guard/result contract enforcement 유지

VALIDATION:
- stop condition check: PASS
- run limit check: PASS
- manual override check: PASS
- profile separation check: PASS
- no product scope change check: PASS
