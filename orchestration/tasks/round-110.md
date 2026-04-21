\[ROUND]

COUNTER-PARTICIPANT-FLOW-HARD-LOCK-001



\[TASK TYPE]

bug fix and flow lock



\[OBJECTIVE]

카운터 participant 생성 플로우를 아래 기준으로 완전히 고정한다.



정상 플로우:

store 선택 → category 선택 → manager 선택 → participant 생성 → 카드에서 이름 수기 입력



이후 어떤 경우에도 타가게 아가씨 목록은 노출되면 안 된다.



\[LOCKED RULE]



1\. 종목 선택 다음 단계는 반드시 담당 실장 선택 UI다.

2\. 타가게 아가씨 이름 목록, 출근 목록, 후보 목록은 어떤 형태로도 노출 금지다.

3\. participant 생성 필수조건은



&#x20;  \* store 선택

&#x20;  \* category 선택

&#x20;  \* manager 선택

&#x20;    이 세 가지다.

4\. 이름은 participant 생성 이후 카드에서 인라인 수기 입력한다.

5\. 이름 오입력은 허용한다.

6\. 이름 수정은 audit 로그를 남긴다.

7\. settlement / checkout 로직은 건드리지 않는다.



\[CURRENT BUG TO ELIMINATE]



\* 종목 선택 후 hostess 목록이 뜨는 모든 렌더 경로 제거

\* manager 선택 UI만 남김

\* role=hostess API 호출 0건 유지

\* role=manager 응답만 사용



\[REQUIRED]



1\. page.tsx 및 관련 호출 경로에서 hostess 목록 렌더링 분기 전부 제거

2\. 종목 선택 후 바텀시트 제목/내용이 manager 선택 전용인지 확인

3\. `/api/store/staff?role=manager\&store\_name=...` 만 사용하도록 고정

4\. `role=hostess` 호출 또는 hostess candidate state가 남아 있으면 제거

5\. participant 생성 후 이름 입력은 카드 인라인 input만 사용

6\. 이름 바텀시트 / 이름 후보 / 자동 매칭 후보 UI 금지



\[VALIDATION]



1\. 버닝 선택 → 퍼블릭 선택 후 `버닝실장1, 버닝실장2...` 같은 manager 목록만 보여야 한다

2\. `버닝아가씨1, 버닝아가씨2...` 같은 hostess 목록은 절대 보이면 안 된다

3\. DevTools network 에서 counter 페이지 기준 `role=hostess` 호출 0건

4\. manager 선택 후 PATCH 200

5\. participant 생성 정상

6\. 카드에서 이름 인라인 입력 가능



\[FORBIDDEN]



\* 리팩토링 금지

\* 컴포넌트 분리 금지

\* 새 기능 추가 금지

\* settlement 수정 금지

\* checkout 수정 금지

\* 권한 확대 금지



\[OUTPUT]



1\. 제거한 hostess 관련 상태/렌더/API 경로

2\. manager 선택만 남은 실제 렌더 경로

3\. PATCH 성공 여부

4\. 최종 동작 확인



