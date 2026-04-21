\[ROUND]

CROSS-STORE-NAME-CORRECTION-001



\[TASK TYPE]

controlled ui + permission + state change



\[OBJECTIVE]

participant 이름 매칭 상태를 명확히 표시하고,

origin store 담당 실장이 participant 이름을 수정할 수 있도록 하며,

수정 사실이 양쪽에 표시되도록 구현한다.



\---



\[DOMAIN INPUT]



\* COUNTER-MANAGER-FIRST-NAME-EDIT

\* MANAGER\_PARTICIPANT\_CONTROL

\* CROSS\_STORE\_NAME\_CORRECTION\_RULE



\---



\## 1. 매칭 상태



participant는 아래 상태를 가진다:



\* matched

\* unmatched



\### 판정 기준



\* 정확히 아가씨 이름과 일치 → matched

\* 일치하지 않음 → unmatched



\---



\## 2. 카운터 UI 표시



participant 카드에 상태 표시 추가:



\### unmatched



\* "매칭 실패 / 수정 바람" 표시 (빨간 텍스트 or badge)



\### matched



\* 별도 표시 없음 또는 "확정됨" 표시



\---



\## 3. 실장(Manager) 화면 표시



origin\_store 담당 실장도 동일한 상태를 본다:



\* unmatched participant 표시

\* "매칭 실패 / 수정 바람" 표시

\* 수정 가능한 input 제공



\---



\## 4. 교차 수정 권한



origin store 담당 실장은:



\### 허용



\* 이름 수정 (external\_name)



\### 금지



\* store 변경

\* category 변경

\* manager 변경

\* time 변경

\* settlement 관련 변경



\---



\## 5. 수정 후 처리



이름 수정 시:



\* 다시 매칭 판정 수행

\* matched / unmatched 상태 갱신



\---



\## 6. 수정 흔적 UI



participant 카드에 표시:



\* "이름 수정됨" badge 또는 텍스트

\* 필요 시 수정 아이콘 표시



\---



\## 7. audit 확장



이름 수정 시 audit에 추가 필드 포함:



\* match\_status\_before

\* match\_status\_after



기존:



\* before\_name

\* after\_name



\---



\## 8. 접근 제한



origin store 실장은:



\### 허용



\* 해당 participant만 조회



\### 금지



\* 다른 participant 조회

\* 다른 방 조회

\* 다른 매장 내부 조회



\---



\## 9. 구현 범위



\[TARGET FILES]



\* app/counter/page.tsx

\* app/api/rooms/\[room\_uuid]/participants/route.ts

\* app/api/sessions/participants/\[participant\_id]/route.ts

\* (실장 화면 파일 1개 필요 시 추가)



\---



\## 10. CONSTRAINTS



\* DB schema 추가 금지

\* settlement 로직 수정 금지

\* checkout 로직 수정 금지

\* 기존 금액 계산 로직 수정 금지

\* 기존 participant 구조 유지



\---



\## 11. VALIDATION



\* unmatched 상태 정확히 표시

\* 이름 수정 후 상태 갱신 확인

\* origin store 실장만 수정 가능

\* 수정 후 audit 기록 생성

\* 타입 에러 0건



\---



\## 12. OUTPUT



1\. 상태 표시 방식

2\. 매칭 판정 로직

3\. 실장 화면 변경 내용

4\. 수정 UI 방식

5\. audit 확장 내용

6\. 권한 검증 방식



