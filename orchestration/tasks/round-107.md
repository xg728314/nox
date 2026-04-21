\[ROUND]

PARTICIPANT-NAME-CORRECTION-PERMISSION-TIGHTEN-001



\[TASK TYPE]

permission hardening



\[OBJECTIVE]

participant 이름 수정 권한을 계약 기준에 맞게 축소한다.



\[CURRENT PROBLEM]

현재 origin store 측 이름 수정 권한이

해당 participant의 담당 실장 본인이 아니라

origin store 전체 owner/manager에게 열려 있다.



이것은 권한이 너무 넓다.



\[REQUIRED RULE]



1\. working store 측

\- owner / manager 는 이름 수정 가능



2\. origin store 측

\- 해당 participant의 담당 manager\_membership\_id 본인만 이름 수정 가능

\- origin store 전체 owner/manager에게 열면 안 됨



3\. 공통

\- 수정 가능 범위는 이름만

\- category / store / manager / time / settlement 관련 값 수정 금지



\[FILES]

\- app/api/sessions/participants/\[participant\_id]/route.ts

\- 필요 시 manager participants route 확인 허용



\[CONSTRAINTS]

\- DB schema 추가 금지

\- settlement 로직 수정 금지

\- checkout 로직 수정 금지

\- UI 수정 최소화

\- 추측 금지



\[VALIDATION]

\- working store owner/manager 수정 가능

\- origin store에서 participant.manager\_membership\_id 본인만 수정 가능

\- origin store의 다른 manager/owner는 403

\- hostess는 계속 403

\- 타입 에러 0건



\[OUTPUT]

1\. 수정한 권한 조건

2\. 허용/차단 매트릭스

3\. 근거 필드

4\. 미확인 제약사항

