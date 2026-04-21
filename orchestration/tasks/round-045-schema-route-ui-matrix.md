# round-045: DB-API-UI 매트릭스 확정

[ROUND]
round-045

[TASK TYPE]
analysis / documentation

[GOAL]
DB-API-UI 매트릭스 확정 및 기준점 잠금

[OBJECTIVE]
- 21개 DB 테이블의 실제 사용 현황을 정리한다
- 27개 API 라우트가 어떤 테이블을 읽고 쓰는지 매핑한다
- 6개 프론트 페이지가 어떤 API를 호출하는지 매핑한다
- 누락된 핵심 페이지 목록을 정리한다

[CONSTRAINTS]
- 추측 금지
- 실제 파일 기준으로만 작성
- 기존 파일 수정 금지

[TARGET FILE]
docs/NOX_SCHEMA_ROUTE_UI_MATRIX.md

[TASK]
아래 3가지 매트릭스를 조사해서
docs/NOX_SCHEMA_ROUTE_UI_MATRIX.md 파일로 생성:

매트릭스 1: 테이블 사용 현황 (21개)
각 테이블별로:
- API 참조 여부
- 프론트 참조 여부
- 사용 상태 (active / unused / reserved)

매트릭스 2: API 라우트 → 테이블 매핑 (27개)
각 API가 어떤 테이블을 읽고 쓰는지

매트릭스 3: 프론트 페이지 → API 매핑 (6개)
각 페이지가 어떤 API를 호출하는지
+ 누락된 핵심 페이지 목록

[ALLOWED_FILES]
- docs/NOX_SCHEMA_ROUTE_UI_MATRIX.md (신규 생성)
- orchestration/tasks/round-045-schema-route-ui-matrix.md (신규 생성)

[FORBIDDEN_FILES]
- docs/** 기존 파일 수정 금지
- database/** 수정 금지

[FAIL IF]
- 추측으로 내용 작성
- 기존 파일 수정
- 실제 코드 확인 없이 작성

[OUTPUT FORMAT]
[FILES CHANGED]
- 파일 경로

[ROOT CAUSE]
- 왜 필요한지

[EXACT DIFF SUMMARY]
- 무엇을 작성했는지

[VALIDATION]
- 검증 결과

[KNOWN LIMITS]
- 제한사항

[NEXT BLOCKER]
- 다음 진행 차단 요소
