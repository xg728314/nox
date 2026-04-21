\# CROSS-STORE NAME CORRECTION RULE (LOCKED)



\## 1. 기본 원칙



다른 가게 내부 정보는 열람할 수 없다.



\## 2. 예외 허용



타가게 아가씨가 현재 세션에 참여한 경우,

그 아가씨의 원소속 담당 실장은 해당 participant 항목에 한해 열람 가능하다.



이 예외는 세션 참여 participant 단위에만 적용된다.

타가게의 다른 방, 다른 participant, 다른 내부 운영 정보는 열람할 수 없다.



\## 3. 열람 가능 주체



\* 현재 세션이 발생한 working store 측 운영자

\* 해당 participant 아가씨의 origin store 담당 실장



\## 4. 수정 가능 범위



origin store 담당 실장은 이름만 수정할 수 있다.



수정 가능:



\* participant name / external\_name



수정 불가:



\* store

\* category

\* manager

\* time

\* settlement 관련 값

\* 다른 participant 정보



\## 5. 수정 흔적



이름이 수정되면 해당 participant에

"이름 수정됨" 상태가 표시되어야 한다.



이 표시를 working store 측과 origin store 담당 실장 모두 볼 수 있어야 한다.



\## 6. 로그



이름 수정 시 아래가 기록되어야 한다.



\* participant\_id

\* session\_id

\* before\_name

\* after\_name

\* actor\_membership\_id

\* actor\_store\_uuid

\* actor\_role

\* timestamp



\## 7. 금지



이 예외 규칙을 근거로 타가게 내부 전체를 조회하는 것은 금지한다.

권한 범위는 오직 해당 participant 이름 정정에 한정된다.



