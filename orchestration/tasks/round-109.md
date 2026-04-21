\[ROUND]

COUNTER-REFACTOR-PARTICIPANT-LIST-001



\[TASK TYPE]

safe ui extraction

\[STATUS]

ON HOLD



\[REASON]

participant 생성 플로우 버그(아가씨 목록 노출, PATCH 400) 미해결 상태에서 리팩토링 진행됨

\[OBJECTIVE]

app/counter/page.tsx 에서 participant 목록 렌더링 영역을

별도 컴포넌트로 분리한다.



\[TARGET]

\- 새 파일: app/counter/ParticipantList.tsx

\- 수정 파일: app/counter/page.tsx



\[SCOPE]

ParticipantRow를 map으로 렌더링하는 participant 목록 블록만 분리한다.



\[REQUIRED]

1\. ParticipantList 컴포넌트 생성

2\. 기존 page.tsx 의 participant 목록 렌더링 블록을 ParticipantList로 치환

3\. 기존 로직 변경 금지

4\. 상태 이동 금지

5\. 계산식 변경 금지

6\. props로 필요한 값만 전달



\[ALLOWED]

\- hostesses 목록

\- selectedHostess

\- focusData.started\_at

\- currentTimeBasis / time basis 관련 표시값

\- 현재 row 렌더링에 필요한 콜백 전달

&#x20; - onToggle

&#x20; - onOpenEdit

&#x20; - onNameBlur

&#x20; - onMidOut



\[FORBIDDEN]

\- hooks 분리 금지

\- API 호출 로직 이동 금지

\- checkout 로직 수정 금지

\- settlement 관련 로직 수정 금지

\- participant 데이터 구조 변경 금지



\[VALIDATION]

\- tsc --noEmit 0 errors

\- 미지정 카드 클릭 정상

\- 이름 blur 수정 정상

\- 선택 토글 정상

\- 제거 버튼 정상



\[OUTPUT]

1\. 새 파일

2\. page.tsx 에서 줄어든 영역

3\. 전달 props 목록

4\. 로직 변경 여부 (없어야 함)

