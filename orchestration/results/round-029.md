FILES CHANGED:

* orchestration/scripts/run-round.ps1
* orchestration/rules/NOX\_ORCHESTRATION\_EXECUTION\_RULES.md
* orchestration/docs/NOX\_AUTO\_LOOP\_SPEC.md

ROOT CAUSE:

* validator가 warn-only 상태라 실제 enforcement가 되지 않았음
* task/result contract 위반이 실행 단계에서 차단되지 않았음
* auto-loop spec과 실행 스크립트 간 enforcement 기준이 분리되어 있었음

EXACT DIFF:

* run-round.ps1: warn-only → blocking enforcement (exit 1), result file validation 추가
* NOX\_ORCHESTRATION\_EXECUTION\_RULES.md: FAIL 조건을 BLOCK / WARN→BLOCK / MANUAL\_REVIEW 3단계로 분류
* NOX\_AUTO\_LOOP\_SPEC.md: enforcement classification 추가, 실행 주체별(run-round / validator / manual) 역할 명시

VALIDATION:

* task contract enforcement check: 필수 섹션 누락 시 즉시 차단됨
* result contract enforcement check: FILES CHANGED / ROOT CAUSE / EXACT DIFF / VALIDATION 누락 시 차단됨
* scope violation blocking check: forbidden/config 변경 시 BLOCK 처리
* empty/malformed result handling check: result 비어있거나 형식 깨지면 차단됨
* no product scope change check: app/, lib/ 변경 없음

