\[ROUND]

COUNTER-MANAGER-FIRST-NAME-EDIT-001



\[TASK TYPE]

flow redesign and controlled ui/api change



\[OBJECTIVE]

카운터 participant 생성 흐름을

store → category → manager 선택까지로 완료시키고,

이름은 participant 카드에서 인라인 수기 입력/수정하도록 변경한다.



또한 이름 매칭 성공/실패 상태를 명확히 표시하고,

매칭 실패 시 카운터와 담당실장 모두가 확인하고 수정할 수 있게 한다.



\[REQUIRED BEHAVIOR]



1\. 바텀시트 흐름

\- store 선택

\- category 선택

\- manager 선택

\- 여기까지 완료되면 participant 생성/확정

\- 이름 입력 단계 바텀시트는 제거



2\. participant 카드

\- 카드에 이름 입력칸을 항상 표시

\- 이름이 비어 있어도 participant는 유효

\- 이름 오입력이어도 저장 허용

\- 이름은 나중에 수정 가능



3\. 이름 매칭 규칙

\- 이름을 정확히 입력해서 기존 아가씨와 일치하면 `매칭 성공`

\- 이름이 정확히 일치하지 않거나 확정 불가능하면 `매칭 실패`

\- 부분 입력/오타/불일치 상태는 자동 확정하지 않는다

\- 매칭 실패 상태는 participant 카드에 보여야 한다



4\. 매칭 실패 표시

\- 카운터 화면에 `매칭 실패 / 수정 바람` 표시

\- 담당실장 측 화면/관리 화면에도 동일하게 `매칭 실패 / 수정 바람` 표시

\- 이 상태를 보고

&#x20; - 이름 오타인지

&#x20; - 가게 선택이 잘못됐는지

&#x20; - 담당 실장이 잘못 선택됐는지

&#x20; 확인 가능해야 한다



5\. 수정 권한 규칙

\- 이름 수정은 허용

\- 이름 외 필드는 수정 금지

\- 타가게/타담당 접근이 필요한 경우에도 허용 범위는 이름 수정만

\- category 변경, manager 변경, store 변경, 정산 관련 값 변경은 금지



6\. 수정 후 처리

\- 이름 수정 후 다시 매칭 시도 가능해야 한다

\- 수정 결과가 정확히 일치하면 `매칭 성공`으로 전환

\- 여전히 불일치면 `매칭 실패` 유지



7\. 로그 규칙

\- 이름 수정 시 audit 로그를 남긴다

\- 최소 기록:

&#x20; - participant\_id

&#x20; - session\_id

&#x20; - before\_name

&#x20; - after\_name

&#x20; - match\_status\_before

&#x20; - match\_status\_after

&#x20; - actor

&#x20; - timestamp



\[REMOVE]

\- 이름 입력 바텀시트

\- 이름 자동 매칭 강제 확정

\- 이름 미입력 시 완료 차단



\[KEEP]

\- store 선택

\- category 선택

\- manager 선택

\- participant 카드 표시

\- count 표시

\- entered\_at 확정 시점 관리



\[CONSTRAINTS]

\- settlement 로직 수정 금지

\- checkout 로직 수정 금지

\- 기존 금액 계산 수정 금지

\- DB schema 추가 금지

\- 실제 존재하는 필드만 사용

\- 추측 금지



\[OUTPUT]

1\. 변경 파일 목록

2\. 바텀시트 변경 내용

3\. participant 생성 확정 시점

4\. 이름 인라인 수정 방식

5\. 매칭 성공/실패 표시 방식

6\. 담당실장 화면에서의 실패 표시 방식

7\. 이름 수정 audit 기록 방식

8\. 미확인 권한/제약사항

