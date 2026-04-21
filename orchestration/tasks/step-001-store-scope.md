[ROUND]
STEP-001

[TASK TYPE]
single-domain minimal foundation lock

[OBJECTIVE]
가게 1개 기준 최소 보안 스코프 출발점을 잠근다.

이번 작업에서 허용되는 목표는 아래 3개뿐이다.
1. `store_uuid`가 단일 가게 보안 기준인지 실제 코드 기준으로 확인/보강
2. membership 최소 1건 기준 read path 확인/보강
3. “현재 사용자 → 현재 store 소속 여부”를 코드 기준으로 판단 가능한 최소 구조 정리

이번 단계에서는 room / session / participant / settlement / BLE / UI 확장으로 절대 넘어가지 않는다.

[CONSTRAINTS]
- 한 번에 하나만 만든다
- 최소 수정만 허용한다
- 추측 구현 금지
- 임시 fallback 금지
- validator 우회 금지
- product 전역 확장 금지
- room 관련 확장 금지
- session 관련 확장 금지
- participant 관련 확장 금지
- settlement 계산 추가 금지
- BLE 경로 수정 금지
- UI 대규모 수정 금지
- multi-store 확장 금지
- SaaS 확장 구조 작업 금지
- 자동 반복 에이전트 연결 금지
- 기존 규칙과 충돌 시 무리해서 확장하지 말고 최소 범위에서만 정리한다

[FAIL IF]
- room/session/participant/settlement/BLE/UI 쪽 수정이 발생하면 실패
- `store_uuid` 기준이 아닌 다른 식별 기준을 새 보안 기준처럼 도입하면 실패
- membership 최소 read path를 넘어서 승인 플로우 전체 구현으로 확장되면 실패
- 추측성 helper / 임시 우회 코드 / fallback 분기가 추가되면 실패
- ALLOWED_FILES 밖 수정이 발생하면 실패
- FORBIDDEN_FILES 수정이 발생하면 실패
- 결과 보고서 형식이 누락되면 실패

[OUTPUT FORMAT]
FILES CHANGED:
- <actual file path>

ROOT CAUSE:
- <why this work was required>

EXACT DIFF SUMMARY:
- <exact code-level changes only>

VALIDATION:
- <code-based / type-based / run-based evidence>

NOT INCLUDED:
- <intentionally excluded scope>

[TARGET FILES]
- C:\work\wind\lib\auth\
- C:\work\wind\lib\security\
- C:\work\wind\app\api\

[ALLOWED_FILES]
- C:\work\wind\lib\auth\**
- C:\work\wind\lib\security\**
- C:\work\wind\app\api\**

[FORBIDDEN_FILES]
- C:\work\wind\components\**
- C:\work\wind\hooks\**
- C:\work\wind\supabase\**
- C:\work\wind\package.json
- C:\work\wind\package-lock.json
- C:\work\wind\tsconfig.json
- C:\work\wind\next.config.js
- C:\work\wind\middleware.ts
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\orchestration\config\orchestrator.config.json
- C:\work\nox\orchestration\rules\**
- C:\work\nox\orchestration\docs\**
- C:\work\nox\orchestration\handoff\**
- C:\work\nox\orchestration\scripts\**

[INSTRUCTIONS]
1. 현재 코드베이스에서 `store_uuid`와 membership 관련 실제 기준 파일을 찾는다.
2. “단일 store 소속 판단”에 필요한 최소 read path만 정리/보강한다.
3. 기존 규칙과 충돌하지 않게 최소 수정만 한다.
4. room/session/settlement/BLE/UI 쪽으로 절대 확장하지 않는다.
5. 이미 구조가 준비되어 있으면 무수정 종료도 허용한다. 단, 코드 근거와 함께 보고해야 한다.

[STOP CONDITIONS]
- 최소 store scope + membership read path 기준이 확인되면 즉시 종료
- 추가 확장이 필요해 보여도 이번 라운드에서는 멈춘다
- 다음 단계(Room 1개)는 절대 이번 라운드에 포함하지 않는다