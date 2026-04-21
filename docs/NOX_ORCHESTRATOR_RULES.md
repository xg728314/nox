# NOX ORCHESTRATOR RULES (LOCKED)

## 0. PURPOSE
이 문서는 NOX 프로젝트의 오케스트레이션 규칙을 정의한다.
모든 AI 작업은 이 규칙에 따라 실행된다.

---

## 1. ORCHESTRATION GOAL
- 작업을 작은 단위로 분해한다
- 실행기를 명확히 지정한다
- 결과를 검증한다
- 실패 시 즉시 중단한다
- 다음 작업은 오케스트레이터만 결정한다

---

## 2. AGENT ROLES

### 2.1 ChatGPT
- 전체 작업 계획 수립
- 작업 단위 분해
- 프롬프트 작성
- 결과 검수
- 다음 작업 결정

### 2.2 Claude Code
- 메인 실행기
- 단일 파일 수정
- 작은 범위 구현
- 지시 범위 밖 수정 금지

### 2.3 Cursor
- 코드 탐색
- 문서 정리
- 구조 확인
- 병렬 가능한 독립 작업

### 2.4 Codex
- 테스트 코드 작성
- 반복성 높은 유틸 작성
- 보조 생성 작업

---

## 3. EXECUTION RULES

### 3.1 DEFAULT UNIT
- 기본 작업 단위는 single-file controlled change

### 3.2 SMALL TASK ONLY
- 큰 범위 작업 금지
- 항상 작은 범위로 분리

### 3.3 NO SELF-DIRECTED NEXT TASK
- 실행기가 다음 작업을 스스로 정하면 안 된다
- 다음 작업은 오케스트레이터만 정한다

### 3.4 FAIL = STOP
- validator 실패 시 즉시 STOP
- 자동 다음 라운드 진행 금지

---

## 4. TASK CONTRACT

모든 작업 지시문은 아래 항목을 포함해야 한다.

- [TASK TYPE]
- [OBJECTIVE]
- [TARGET FILE]
- [ALLOWED FILES]
- [FORBIDDEN FILES]
- [INSTRUCTIONS]
- [OUTPUT]
- [VALIDATION]
- [STOP CONDITIONS]

---

## 5. FILE CONTROL RULES

### 5.1 TARGET FILE REQUIRED
- 모든 작업은 정확한 대상 파일을 명시해야 한다

### 5.2 ALLOWED FILES REQUIRED
- 수정 가능한 파일을 명시해야 한다

### 5.3 FORBIDDEN FILES REQUIRED
- 수정 금지 파일을 명시해야 한다

### 5.4 CONTRACT VIOLATION
- 허용되지 않은 파일 수정 시 FAIL 처리

---

## 6. VALIDATION RULES

### 6.1 REQUIRED VALIDATION
- 모든 작업에는 검증 기준이 있어야 한다

### 6.2 VALIDATION FAIL
- 검증 실패 시 STOP

### 6.3 INCOMPLETE RESULT
- 결과가 불완전하면 FAIL

### 6.4 UNKNOWN CHANGE
- 예상 외 변경 발생 시 FAIL

---

## 7. PARALLEL RULES

### 7.1 PARALLEL ALLOWED ONLY IF
- 서로 다른 파일
- 상태 공유 없음
- 충돌 가능성 낮음
- 실패 시 다른 작업에 영향 적음

### 7.2 SAFE PARALLEL EXAMPLES
- 문서 작성
- 체크리스트 작성
- 계약 문서 작성
- 구조 탐색

### 7.3 PARALLEL FORBIDDEN
- auth core
- database core
- settlement core
- BLE core
- shared state
- core membership logic

---

## 8. TELEGRAM NOTIFICATION RULES

전송 허용 알림:
- START
- PASS
- FAIL
- STOP
- REVIEW

중간 잡로그 전송 금지.

---

## 9. WORKSPACE RULES

### 9.1 ACTIVE ROOT
C:\work\nox

### 9.2 FORBIDDEN ROOT
C:\work\wind

### 9.3 WIND POLICY
- wind는 참고 전용
- 수정 금지
- import 금지
- 직접 복붙 금지

---

## 10. EXECUTION FLOW

1. 오케스트레이터가 작업 정의
2. 실행기 선택
3. 프롬프트 생성
4. 작업 실행
5. 결과 저장
6. validator 검사
7. PASS면 다음 작업 후보 생성
8. FAIL이면 즉시 STOP
9. Telegram 알림 전송

---

## 11. STOP TRIGGERS

아래 상황이면 즉시 STOP:
- validator fail
- contract violation
- unknown file change
- incomplete output
- forbidden file modification
- ambiguous result
- unsafe parallel attempt

---

## 12. FINAL RULE

NOX의 자동화는 "빠른 반복"보다 "통제된 반복"을 우선한다.
작업이 빨라도 규칙이 깨지면 실패다.
