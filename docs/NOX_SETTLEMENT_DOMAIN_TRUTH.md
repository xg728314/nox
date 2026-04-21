\# NOX\_SETTLEMENT\_DOMAIN\_TRUTH (LOCKED)



이 문서는 NOX 정산 도메인의 단일 진실원(Source of Truth)이다.

모든 DB, API, UI, 정산 계산, 리포트는 본 문서를 기준으로 구현되어야 한다.



추측, 보정, 임의 해석을 금지한다.



\---



\# 0. GLOBAL PRINCIPLES



\## MUST



\* 모든 정산 계산은 서버에서 수행되어야 한다.

\* 클라이언트 계산값은 신뢰하지 않는다.

\* 정산은 항상 `store\_uuid` 스코프 내에서 처리된다.

\* 세션은 `session\_id` 기준으로 관리된다.

\* 정산은 항상 `business\_day\_id` 기준으로 집계된다.



\## MUST NOT



\* 클라이언트에서 금액을 계산하거나 확정하지 않는다.

\* cross-store 데이터를 혼합 집계하지 않는다.

\* finalized 정산을 수정하지 않는다.



\---



\# 1. 차수 정의 (TIME MODEL)



\## 1.1 개념 정의



차수는 문자열이 아니라 다음 두 요소의 조합으로 정의된다.



\* `service\_type`: 서비스 종목

\* `time\_type`: 시간 판정 결과



\---



\## 1.2 service\_type



허용 값:



\* 퍼블릭

\* 셔츠

\* 하퍼



\---



\## 1.3 time\_type



허용 값:



\* NONE (0원 구간)

\* 차3

\* 반티

\* 기본



\---



\## 1.4 기준 시간



| service\_type | 기본  | 반티  | 차3    |

| ------------ | --- | --- | ----- |

| 퍼블릭          | 90분 | 45분 | 9\~15분 |

| 셔츠           | 60분 | 30분 | 9\~15분 |

| 하퍼           | 60분 | 30분 | 9\~15분 |



\---



\## 1.5 판정 규칙



\### MUST



\* 0\~8분 → `time\_type = NONE`

\* 9\~15분 → `time\_type = 차3`

\* 반티 기준 이하 → `time\_type = 반티`

\* 그 이상 → `time\_type = 기본`



\### MUST



\* 최종 판정은 서버가 수행한다.

\* UI 선택은 참고값일 뿐이다.



\---



\## 1.6 경계 처리



\### MUST



\* 경계구간(예: 반티+10분)은 자동 판정하지 않는다.

\* UI에서 명시적으로 선택해야 한다.



\### MUST



\* `반티 + 차3`는 단일 값이 아니라 조합 결과다.

\* 저장은 단일 `time\_type`이 아니라 판정 결과로 계산한다.



\---



\## 1.7 가격 규칙



\### MUST



\* 가격은 하드코딩 금지

\* `store\_service\_types` 기준 조회



\### MUST NOT



\* 클라이언트에서 단가 계산



\---



\## 1.8 구현 매핑 (CRITICAL)



현재 코드와의 매핑은 다음과 같다.



\* `category` → `service\_type`

\* `order\_type` / participant action → `time\_type 입력값 (임시)`

\* `"차3"`, `"반티"`, `"완티"` → 최종 time\_type이 아님



\### MUST



\* 서버는 입력값을 그대로 쓰지 않고 재계산해야 한다.



\---



\# 2. TC 정의



\## 2.1 정의



TC는 참여자 타임 수행 결과를 집계한 파생값이다.



\---



\## 2.2 계산 기준



\### MUST



\* TC는 `session\_participants` 기반으로 계산

\* 클라이언트 계산 금지



\---



\## 2.3 표현



\* 건수

\* 총액



\---



\## 2.4 권한



\### MUST



\* owner는 총 TC만 조회 가능



\### MUST NOT



\* 개별 아가씨 수익 노출 금지

\* 실장 수익 노출 금지



\---



\## 2.5 구현 원칙



\### MUST



\* TC는 저장값이 아니라 계산값이다



\---



\# 3. CHECKOUT \& SETTLEMENT



\## 3.1 checkout 정의



checkout은 세션 종료 기록이다.

정산 확정이 아니다.



\---



\## 3.2 상태



\* draft

\* finalized



\---



\## 3.3 상태 전이



\### MUST



\* draft → finalized만 허용



\### MUST NOT



\* finalized → draft 금지



\---



\## 3.4 정산 계산



\### MUST



\* 서버에서만 계산

\* 클라이언트 금액 무시



\---



\## 3.5 draft 수정 범위



\### 허용



\* 이름 수정

\* service\_type 수정

\* time\_type 재판정

\* 실장 변경

\* 주문 수정



\### 금지



\* finalized 수정

\* business\_day 변경

\* origin\_store\_uuid 변경



\---



\## 3.6 finalized 규칙



\### MUST



\* finalized 이후 데이터 불변



\### MUST



\* 재계산 시 새로운 버전 생성



\---



\## 3.7 영업일 규칙



\### MUST



\* `business\_day\_id` 기준 사용

\* 자정 기준 아님

\* 세션 시작 기준 귀속 유지



\---



\# 4. PARTICIPANT MODEL



\## 4.1 참여자 상태



\### MUST



\* 참여자는 생성 시 완전한 상태여야 한다



\### MUST NOT



\* placeholder UUID 사용 금지



\---



\## 4.2 미지정 참여자



\### MUST



\* 별도 상태로 관리 (예: pending\_identity)



\### MUST



\* finalized 전 반드시 확정



\---



\# 5. CROSS-STORE



\## 5.1 식별자



\* `store\_uuid`: 근무 매장

\* `origin\_store\_uuid`: 원소속



\---



\## 5.2 핵심 규칙



\### MUST



\* 정산 귀속은 origin\_store\_uuid 기준



\### MUST NOT



\* 근무 매장 기준으로 지급 처리 금지



\---



\## 5.3 승인



\### MUST



\* cross-store 참여는 승인 필요



\---



\## 5.4 소속 기준 시점



\### MUST



\* 참여 시점 스냅샷 사용



\---



\## 5.5 집계



\### MUST



\* 모든 지급은 origin\_store 기준



\---



\# 6. UI VS DOMAIN



\## 6.1 시간 기준 토글



\### MUST



\* room / individual 토글은 UI 표시용



\### MUST NOT



\* 정산 계산에 영향 주지 않는다



\---



\## 6.2 금액 표시



\### MUST



\* UI 합계는 참고값



\### MUST NOT



\* 정산 기준으로 사용 금지



\---



\# 7. FINAL RULE



NOX 정산 시스템은 다음 4가지 원칙으로 동작한다.



1\. 차수는 service\_type + time\_type 기반이다

2\. 정산은 서버 계산만 허용된다

3\. checkout과 finalized는 분리된다

4\. cross-store 정산은 origin\_store 기준이다



이 규칙을 위반하는 구현은 모두 잘못된 구현이다.



