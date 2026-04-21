\[ROUND]

SESSION-PARTICIPANT-MANAGER-MIGRATION-001



\[TASK TYPE]

controlled schema + api change



\[OBJECTIVE]

session\_participants 에 session-level 담당실장 식별 컬럼을 추가하고,

participant PATCH / GET 에 반영한다.



\[REQUIRED CHANGE]



1\. DB / schema



\* session\_participants.manager\_membership\_id 컬럼 추가

\* 타입: UUID

\* FK: store\_memberships(id)

\* NULL 허용



2\. PATCH route



\* participant PATCH 에 manager\_membership\_id 입력 허용

\* 저장 전 검증:



&#x20; \* 해당 membership이 실제 존재해야 함

&#x20; \* role = manager 여야 함

&#x20; \* session\_participants.session\_id 가 속한 working store\_uuid 와

&#x20;   manager membership.store\_uuid 가 같아야 함

\* 검증 실패 시 400 반환



3\. participants GET route



\* 응답에 manager\_membership\_id, manager\_name 포함

\* 우선순위:



&#x20; \* session\_participants.manager\_membership\_id

&#x20; \* 없으면 hostesses.manager\_membership\_id fallback

\* manager\_name 은 managers 또는 membership/profile 기준 실제 이름 반환



4\. counter page



\* 바텀시트에서 선택한 manager\_membership\_id 를 PATCH 로 저장

\* 새로고침 후에도 담당실장 유지되어야 함

\* 기존 UI 표시 유지



\[CONSTRAINTS]



\* settlement 계산 로직 수정 금지

\* checkout 로직 수정 금지

\* 기존 금액 컬럼/정산 상태 로직 수정 금지

\* 실제 존재하는 스키마/필드만 사용

\* 추측 금지



\[VALIDATION]



\* 타입 에러 0건

\* manager 미선택 시 기존 UI 차단 유지

\* 저장 후 GET 재조회 시 manager\_name 유지

\* 다른 store 소속 manager\_membership\_id 저장 시 400 차단



\[OUTPUT]



1\. 변경 파일 목록

2\. migration SQL

3\. PATCH 검증 규칙

4\. GET 응답 우선순위

5\. 미확인 사항



