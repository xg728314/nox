\# NOX MASTER RULES (LOCKED)



\## 0. PURPOSE

NOX는 실시간 운영 시스템이며,

모든 개발은 안정성, 복구 가능성, 보안, 확장성을 최우선으로 한다.



이 문서는 NOX 프로젝트의 절대 규칙이며,

모든 코드, 설계, 자동화, 작업은 이 규칙을 반드시 따른다.



\---



\## 1. CORE PRINCIPLES



\### 1.1 NO GUESSING

\- 추측 금지

\- 불확실한 경우 반드시 확인 후 진행

\- 임의 구현 금지



\---



\### 1.2 SMALL TASK ONLY

\- 모든 작업은 작은 단위로 분할

\- 한 번에 큰 범위 작업 금지

\- 기본 단위: single-file change



\---



\### 1.3 FAIL = STOP

\- validator 실패 시 즉시 중단

\- 자동 진행 금지

\- 다음 작업은 오케스트레이터 판단 후 재시작



\---



\### 1.4 ORCHESTRATOR CONTROL ONLY

\- AI가 다음 작업을 스스로 결정 금지

\- 모든 다음 작업은 오케스트레이터(ChatGPT)가 결정



\---



\### 1.5 STATE OVER MEMORY

\- 메모리 상태 의존 금지

\- 모든 중요한 상태는 기록 기반으로 관리



\---



\## 2. WORKSPACE RULES



\### 2.1 WORKSPACE ROOT

\- 모든 작업은 아래 경로 기준으로 진행



C:\\work\\nox



\---



\### 2.2 FORBIDDEN WORKSPACE

\- 아래 경로는 절대 수정 금지



C:\\work\\wind



\---



\### 2.3 NO CROSS ACCESS

\- nox 코드에서 wind import 금지

\- wind 파일 참조 금지

\- wind는 참고 전용



\---



\### 2.4 REFERENCE POLICY

\- wind는 “참고 자료”이다

\- 코드 복붙 금지

\- 구조/개념만 참고 후 NOX에서 재구현



\---



\### 2.5 REFERENCE LOG REQUIRED

wind를 참고한 경우 반드시 기록:



\[REFERENCE]

source: wind

reason: why referenced

decision: reuse / modify / discard



\---



\## 3. AGENT ROLES



\### 3.1 CHATGPT (ORCHESTRATOR)

\- 작업 분해

\- 작업 지시문 생성

\- 실행기 선택

\- 결과 검수

\- 다음 작업 결정



\---



\### 3.2 CLAUDE CODE (PRIMARY EXECUTOR)

\- 단일 파일 수정

\- 작은 범위 구현

\- 설계 변경 금지

\- 규칙 위반 금지



\---



\### 3.3 CURSOR (SECONDARY)

\- 코드 탐색

\- 구조 분석

\- 문서 생성

\- 병렬 독립 작업



\---



\### 3.4 CODEX (SUPPORT)

\- 테스트 코드

\- 반복 코드

\- 타입/유틸 생성



\---



\## 4. TASK RULES



\### 4.1 SINGLE FILE RULE

\- 기본: 1 작업 = 1 파일

\- multi-file은 명시적 허용 시만 가능



\---



\### 4.2 ALLOWED FILES REQUIRED

\- 작업마다 수정 가능한 파일 명시

\- 그 외 파일 수정 금지



\---



\### 4.3 FORBIDDEN FILES REQUIRED

\- 반드시 금지 파일 명시



\---



\### 4.4 CLEAR OBJECTIVE

\- 작업 목표 명확히 정의

\- 애매한 지시 금지



\---



\### 4.5 VALIDATION REQUIRED

\- 모든 작업은 검증 기준 포함

\- 검증 없는 작업 금지



\---



\## 5. VALIDATION \& STOP RULES



\### 5.1 VALIDATION FAIL

\- 즉시 STOP

\- 자동 다음 작업 금지



\---



\### 5.2 CONTRACT VIOLATION

\- allowed file 외 수정 시 FAIL



\---



\### 5.3 UNKNOWN CHANGE

\- 예상 외 수정 발생 시 FAIL



\---



\### 5.4 INCOMPLETE RESULT

\- 결과 부족 시 FAIL



\---



\## 6. PARALLEL RULES



\### 6.1 PARALLEL ALLOWED ONLY IF

\- import 관계 없음

\- 상태 공유 없음

\- 충돌 가능성 낮음



\---



\### 6.2 PARALLEL FORBIDDEN FOR

\- auth

\- database core

\- shared state

\- settlement core

\- BLE core



\---



\## 7. TELEGRAM RULES



\### 7.1 NOTIFICATION TYPES

\- START

\- PASS

\- FAIL

\- STOP

\- REVIEW



\---



\### 7.2 NO NOISE

\- 중간 로그 전송 금지

\- 핵심 이벤트만 전송



\---



\## 8. RESILIENCE RULES (CRITICAL)



\### 8.1 OFFLINE IS NORMAL

\- 오프라인 상황은 예외가 아니다

\- 시스템은 오프라인을 고려하여 설계



\---



\### 8.2 RESTART SAFE

\- 서버 재시작 후 상태 복구 가능해야 한다



\---



\### 8.3 EVENT BASED

\- 모든 중요한 상태는 이벤트 기반으로 복원 가능해야 한다



\---



\### 8.4 IDEMPOTENT PROCESSING

\- 동일 요청 반복 시 중복 처리 금지



\---



\### 8.5 RESYNC REQUIRED

\- 재연결 시 재동기화 수행



\---



\### 8.6 ANOMALY GUARD

\- 이상 신호는 즉시 반영 금지

\- 검증 후 반영



\---



\## 9. SECURITY RULES



\### 9.1 NO TRUST INPUT

\- 모든 입력은 검증 대상



\---



\### 9.2 STRICT AUTH

\- 권한 없는 요청 즉시 차단



\---



\### 9.3 AUDIT REQUIRED

\- 모든 중요 변경 기록



\---



\### 9.4 ANOMALY DETECTION

\- 이상 패턴 감지 및 제한



\---



\## 10. DEVELOPMENT FLOW



1\. Task 정의

2\. Executor 선택

3\. 작업 실행

4\. 결과 저장

5\. Validation 검사

6\. PASS → 다음 작업

7\. FAIL → STOP

8\. Telegram 알림



\---



\## 11. ABSOLUTE PROHIBITIONS



\- 추측 기반 구현 금지

\- 대규모 변경 금지

\- 규칙 없는 병렬 작업 금지

\- wind 코드 직접 사용 금지

\- workspace 외 작업 금지



\---



\## 12. FINAL RULE



NOX는 “빠르게 만드는 프로젝트”가 아니라  

“절대 무너지지 않는 시스템”을 만드는 프로젝트다.



속도보다 구조를 우선한다.

