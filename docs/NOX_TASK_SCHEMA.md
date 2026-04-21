# NOX TASK SCHEMA (LOCKED)

## 0. PURPOSE
이 문서는 NOX에서 모든 작업 지시문(Task Prompt)의 표준 구조를 정의한다.
모든 AI 작업은 반드시 이 구조를 따른다.

---

## 1. TASK TEMPLATE (MANDATORY)

모든 작업은 아래 형식을 반드시 포함해야 한다.

[TASK TYPE]

[OBJECTIVE]

[TARGET FILE]

[ALLOWED FILES]

[FORBIDDEN FILES]

[INSTRUCTIONS]

[OUTPUT]

[VALIDATION]

[STOP CONDITIONS]

---

## 2. FIELD DEFINITIONS

### 2.1 TASK TYPE
작업 종류 정의

예:
- single-file controlled change
- analysis only
- documentation only
- validation only

---

### 2.2 OBJECTIVE
작업 목표

규칙:
- 왜 이 작업을 하는지 명확히 작성
- 애매한 표현 금지

---

### 2.3 TARGET FILE
수정 대상 파일

규칙:
- 정확한 1개 파일
- 절대 경로 사용 권장

---

### 2.4 ALLOWED FILES
수정 허용 파일 목록

규칙:
- 명시된 파일만 수정 가능
- 그 외 수정 금지

---

### 2.5 FORBIDDEN FILES
수정 금지 파일

필수 포함:
- C:\work\wind 전체
- config 핵심 파일
- 인증/보안 핵심 파일 (초기 단계)

---

### 2.6 INSTRUCTIONS
실제 작업 내용

규칙:
- 구체적으로 작성
- 단계별 작성
- 모호한 표현 금지

---

### 2.7 OUTPUT
결과 보고 방식

예:
- 변경된 코드
- diff 요약
- 변경 이유

---

### 2.8 VALIDATION
검증 기준

반드시 포함:
- 코드 오류 없음
- 타입 오류 없음
- 지정 파일 외 수정 없음

---

### 2.9 STOP CONDITIONS
작업 중단 조건

예:
- 요구사항 불명확
- 파일 없음
- 권한 없음
- 범위 초과

---

## 3. HARD RULES

### 3.1 SINGLE FILE DEFAULT
- 기본은 단일 파일 작업

---

### 3.2 NO HIDDEN CHANGES
- 명시되지 않은 파일 수정 금지

---

### 3.3 NO AUTO EXPANSION
- 작업 범위 자동 확장 금지

---

### 3.4 STRICT CONTRACT
- task contract 위반 시 FAIL

---

## 4. EXAMPLE TASK

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
로그 출력 포맷을 통일한다

[TARGET FILE]
C:\work\nox\app\logger.ts

[ALLOWED FILES]
C:\work\nox\app\logger.ts

[FORBIDDEN FILES]
C:\work\wind
C:\work\nox\orchestration\config

[INSTRUCTIONS]
- 기존 console.log를 제거
- 공통 logger 함수로 변경

[OUTPUT]
- 변경된 코드
- diff 요약

[VALIDATION]
- 타입 오류 없음
- logger 정상 동작

[STOP CONDITIONS]
- 파일 없음
- 구조 불일치

---

## 5. FINAL RULE

TASK는 "작업 지시"가 아니라
"제어 계약(contract)"이다.

이 계약을 벗어나면 실패다.
