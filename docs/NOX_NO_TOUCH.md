# NOX NO TOUCH (LOCKED)

## 0. PURPOSE
이 문서는 NOX 프로젝트에서
명시적 승인 없이는 절대 수정하면 안 되는 영역을 정의한다.

이 문서의 목적:
- 기준 문서 보호
- 핵심 구조 보호
- 오케스트레이션 붕괴 방지
- 무분별한 수정 방지

---

## 1. GLOBAL NO TOUCH RULE

명시적 작업 지시 없이 아래 영역은 절대 수정 금지.

수정 필요 시 반드시:
1. 오케스트레이터 승인
2. TASK 재정의
3. allowed files 재설정

---

## 2. ABSOLUTE NO TOUCH AREAS

### 2.1 LEGACY PROJECT
C:\work\wind\**

설명:
- 기존 프로젝트 원본
- 참고 전용
- 수정 금지
- import 금지
- 복붙 금지

---

### 2.2 ORCHESTRATION CORE CONFIG
C:\work\nox\orchestration\config\**

설명:
- 상태/엔진/중지 규칙
- 자동화 붕괴 위험
- 초기 단계에서 수정 금지

---

### 2.3 MASTER DOCUMENTS
C:\work\nox\docs\NOX_MASTER_RULES.md
C:\work\nox\docs\NOX_ORCHESTRATOR_RULES.md
C:\work\nox\docs\NOX_TASK_SCHEMA.md
C:\work\nox\docs\NOX_PRODUCT_REQUIREMENTS.md
C:\work\nox\docs\NOX_EXECUTION_PLAN.md
C:\work\nox\docs\NOX_FILE_SCOPE.md
C:\work\nox\docs\NOX_NO_TOUCH.md

설명:
- 상위 기준 문서
- 함부로 수정 금지
- 방향 흔들림 방지

---

## 3. CONDITIONAL NO TOUCH AREAS

아래는 해당 STEP 전까지 수정 금지.

### 3.1 AUTH CORE
- auth 구조 잠금 전 수정 금지
- STEP 1 범위 밖 수정 금지

### 3.2 DB CORE
- ERD 잠금 전 migration/schema 수정 금지

### 3.3 SESSION CORE
- STEP 3 전 선구현 금지

### 3.4 SETTLEMENT CORE
- STEP 4 전 선구현 금지

### 3.5 BLE / CHAT
- MVP 완료 전 구현 금지

---

## 4. NO TOUCH BY PHASE

### STEP 0
수정 허용:
- docs 초안 문서만

수정 금지:
- app 실제 기능 코드
- DB migration
- auth 구현
- settlement 구현
- BLE
- chat

---

### STEP 1
수정 허용:
- 계정 / 인증 / 승인 관련 범위

수정 금지:
- session core
- settlement core
- BLE
- chat

---

### STEP 2
수정 허용:
- stores / floors / rooms 관련 범위

수정 금지:
- settlement
- BLE
- chat

---

### STEP 3
수정 허용:
- sessions / participants / room state

수정 금지:
- BLE
- chat
- 고급 정산

---

### STEP 4
수정 허용:
- settlements / orders / pricing rule

수정 금지:
- BLE
- chat
- 리포트 확장

---

## 5. NO TOUCH VIOLATIONS

아래는 즉시 FAIL:
- NO_TOUCH 영역 수정
- 문서 없는 핵심 구조 변경
- 단계 밖 기능 선구현
- wind 파일 변경
- orchestration core 무단 수정

---

## 6. EXCEPTION RULE

예외 수정이 필요한 경우 반드시:
1. 왜 필요한지 기록
2. 어떤 파일을 바꾸는지 명시
3. 왜 지금 바꿔야 하는지 설명
4. 오케스트레이터 승인 후 진행

---

## 7. FINAL RULE

NO_TOUCH는 단순 금지 목록이 아니다.
이 문서는 NOX의 방향이 흔들리지 않게 하는 잠금장치다.

이 규칙을 깨면
작업 속도가 아니라 구조가 무너진다.
