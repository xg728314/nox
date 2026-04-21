[ROUND]
STEP-001B

[TASK TYPE]
alignment-cleanup no-code-change

[OBJECTIVE]
Baseline으로 인정된 ROUND-001~035 산출물의 정합성을 맞추기 위한 정리 작업을 수행한다.

이번 라운드에서 수행하는 작업은 아래 4개뿐이다.

1. state.json 상태 정렬 계획 수립
2. handoff 최신 상태 반영 계획 수립
3. staging 디렉터리 정리 기준 정의
4. results / logs 검증 및 유지 기준 정의

코드 수정은 절대 수행하지 않는다.

[CONSTRAINTS]
- 작업 기준은 C:\work\nox 만 허용
- C:\work\wind 수정 금지
- app\api\** 코드 수정 금지
- lib\** 코드 수정 금지
- 기존 results 내용 수정 금지
- 기존 staging 파일 직접 삭제 금지 (계획만 작성)
- state.json 직접 수정 금지 (계획만 작성)
- handoff 직접 수정 금지 (계획만 작성)
- 단일 라운드 범위 유지
- validator 우회 금지

[FAIL IF]
- 코드 변경 발생 시 FAIL
- 기존 파일 직접 수정 시 FAIL
- 정리 기준 없이 삭제 제안 시 FAIL
- OUTPUT FORMAT 미준수 시 FAIL

[OUTPUT FORMAT]
STATE ALIGNMENT:
- current_phase:
- completed_tasks:
- 문제점:
- 수정 계획:

HANDOFF ALIGNMENT:
- 현재 상태:
- 누락된 round:
- 업데이트 계획:

STAGING CLEANUP PLAN:
- 현재 상태:
- 삭제 대상:
- 유지 대상:
- 기준:

RESULT VALIDATION PLAN:
- 검증 대상:
- 검증 방법:
- 유지 기준:

LOG POLICY:
- 유지 여부:
- 정리 기준:

RISKS:
- 정리 시 발생 가능한 리스크

VALIDATION PLAN:
- 정리 이후 검증 방법

NEXT STEP:
- STEP-002 진입 조건 명시

[TARGET FILES]
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\orchestration\handoff\
- C:\work\nox\orchestration\staging\
- C:\work\nox\orchestration\results\
- C:\work\nox\orchestration\logs\

[ALLOWED_FILES]
- C:\work\nox\orchestration\tasks\step-001B-alignment.md
- C:\work\nox\orchestration\staging\step-001B-alignment.md
- C:\work\nox\orchestration\results\step-001B-alignment.md
- C:\work\nox\orchestration\logs\step-001B-alignment.log

[FORBIDDEN_FILES]
- C:\work\nox\app\api\**
- C:\work\nox\lib\**
- C:\work\nox\components\**
- C:\work\nox\hooks\**
- C:\work\nox\database\**
- C:\work\nox\contracts\**
- C:\work\nox\qa\**
- C:\work\wind\**
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js

[INSTRUCTIONS]
1. 기존 인벤토리 결과를 기반으로 정합성 문제를 정리한다.
2. 실제 수정이 아니라 정리 계획만 작성한다.
3. state / handoff / staging / results / logs 각각에 대해 기준을 정의한다.
4. 삭제가 필요한 경우 반드시 기준을 먼저 정의한다.
5. 코드 수정 없이 문서형 결과만 출력한다.

[STOP CONDITIONS]
- 정합성 문제와 해결 계획이 명확히 정의되면 종료
- 다음 STEP 진입 조건이 정의되면 종료
