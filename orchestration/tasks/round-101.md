\[ROUND]

SESSION-PARTICIPANT-MANAGER-COLUMN-001



\[TASK TYPE]

schema change design only



\[OBJECTIVE]

session\_participants 단위 담당실장 식별을 위해

최소 스키마 변경안을 설계한다.

이번 round에서는 설계와 영향 분석만 수행하고,

실제 DB 변경은 하지 않는다.



\[REQUIRED TARGET]



\* database/002\_actual\_schema.sql 기준 분석

\* session\_participants.manager\_membership\_id 추가안 설계

\* FK 대상: store\_memberships(id)

\* null 허용 여부 판단

\* 기존 hostesses.manager\_membership\_id 와 역할 차이 명확화



\[OUTPUT REQUIRED]



1\. 왜 session\_participants.manager\_membership\_id 가 필요한지

2\. 기존 hostesses.manager\_membership\_id 와 무엇이 다른지

3\. migration SQL 초안

4\. API 영향 범위



&#x20;  \* participants PATCH

&#x20;  \* rooms/\[room\_uuid]/participants GET

&#x20;  \* settlement summary / manager summary

5\. backfill 필요 여부

6\. 위험요소



&#x20;  \* 기존 데이터 null 처리

&#x20;  \* cross-store manager scope

&#x20;  \* 정산 집계 영향



\[CONSTRAINTS]



\* 실제 DB 변경 금지

\* 실제 코드 수정 금지

\* 설계 문서/SQL 초안만 허용

\* 추측 금지



```

```



