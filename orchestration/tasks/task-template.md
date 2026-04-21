# NOX TASK TEMPLATE (LOCKED)

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
- 이 작업의 목표를 명확히 적는다
- 왜 이 작업을 지금 하는지 적는다
- 현재 STEP 범위 안에 있는 작업만 허용한다

[TARGET FILE]
C:\work\nox\path\to\target-file.ext

[ALLOWED FILES]
- C:\work\nox\path\to\target-file.ext

[FORBIDDEN FILES]
- C:\work\wind\**
- C:\work\nox\docs\NOX_MASTER_RULES.md
- C:\work\nox\docs\NOX_ORCHESTRATOR_RULES.md
- C:\work\nox\docs\NOX_TASK_SCHEMA.md
- C:\work\nox\docs\NOX_PRODUCT_REQUIREMENTS.md
- C:\work\nox\docs\NOX_EXECUTION_PLAN.md
- C:\work\nox\docs\NOX_FILE_SCOPE.md
- C:\work\nox\docs\NOX_NO_TOUCH.md
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\orchestration\config\engines.json
- C:\work\nox\orchestration\config\stop-rules.json
- C:\work\nox\orchestration\config\env.example.json

[STEP CONTEXT]
- Current Step:
- Current Goal:
- Why this task is next:

[INSTRUCTIONS]
1. 지정된 TARGET FILE만 수정한다.
2. ALLOWED FILES 밖의 파일은 수정하지 않는다.
3. 현재 STEP 범위를 벗어나는 선행 구현을 하지 않는다.
4. 추측하지 않는다.
5. 필요한 값이 없으면 임의 생성하지 말고 STOP CONDITIONS에 따라 중단한다.

[OUTPUT FORMAT]
반드시 아래 형식으로만 보고한다.

[FILES CHANGED]
- 정확한 파일 경로

[ROOT CAUSE]
- 왜 수정이 필요했는지

[EXACT DIFF SUMMARY]
- 무엇을 어떻게 바꿨는지

[VALIDATION]
- 무엇을 검증했는지
- PASS / FAIL

[KNOWN LIMITS]
- 아직 남아있는 제한사항

[NEXT BLOCKER]
- 다음 진행을 막는 요소

[VALIDATION]
- 타입 오류 없음
- 지정 파일 외 수정 없음
- STEP 범위 위반 없음
- 금지 파일 수정 없음

[STOP CONDITIONS]
- 대상 파일이 없음
- 요구사항이 불명확함
- STEP 범위를 벗어남
- 추가 파일 수정이 필요함
- 핵심 정의 문서와 충돌함
- 금지 파일 수정이 필요해짐

[FINAL RULE]
이 TASK는 제안이 아니라 계약(contract)이다.
범위를 벗어나면 실패다.
