# NOX FILE SCOPE (LOCKED)

## 0. PURPOSE
이 문서는 각 에이전트가 수정 가능한 파일 범위를 정의한다.

목표:
- 작업 충돌 방지
- 구조 붕괴 방지
- 역할 분리 유지
- 예측 가능한 변경 관리

---

## 1. GLOBAL RULES

### 1.1 STRICT FILE SCOPE
- 각 에이전트는 지정된 파일만 수정 가능
- 범위 밖 수정 = 즉시 FAIL

---

### 1.2 NO CROSS DOMAIN EDIT
- 다른 도메인 파일 수정 금지

---

### 1.3 NO AUTO EXPANSION
- 작업 중 파일 범위 확장 금지

---

### 1.4 CONTRACT ENFORCED
- TASK_SCHEMA의 allowed files 기준으로 동작

---

## 2. WORKSPACE ROOT

C:\work\nox

---

## 3. FORBIDDEN ROOT

C:\work\wind

- 접근 금지
- 수정 금지
- import 금지

---

## 4. AGENT FILE SCOPE

---

### 4.1 CLAUDE CODE (PRIMARY EXECUTOR)

허용:
- app/**
- 특정 지정 파일

금지:
- orchestration/config/**
- docs/**
- database/migrations (명시 없는 경우)

역할:
- 단일 파일 수정
- 핵심 기능 구현

---

### 4.2 CURSOR (SECONDARY)

허용:
- docs/**
- contracts/**
- qa/**
- 구조 탐색

금지:
- core app 로직 수정 (명시 없는 경우)
- auth / settlement / DB core

역할:
- 문서 생성
- 구조 분석
- 보조 작업

---

### 4.3 CODEX (SUPPORT)

허용:
- qa/**
- test/**
- utils/**

금지:
- core business logic
- auth
- DB schema

역할:
- 테스트 코드
- 반복 코드

---

### 4.4 CHATGPT (ORCHESTRATOR)

허용:
- 작업 정의
- 범위 설정

금지:
- 직접 코드 수정

역할:
- 전체 제어

---

## 5. CRITICAL PROTECTED AREAS

아래는 반드시 명시적 허용 없이는 수정 금지:

- authentication
- authorization
- settlement core
- session core
- DB schema
- business_date logic

---

## 6. FILE SCOPE VIOLATION

다음은 즉시 FAIL:

- allowed files 외 수정
- 다른 에이전트 영역 수정
- 예상 외 파일 변경
- 숨겨진 변경

---

## 7. SAFE EXPANSION RULE

파일 추가가 필요한 경우:

1. 오케스트레이터 승인 필요
2. 명시적 TASK 업데이트 필요

자동 생성 금지

---

## 8. FINAL RULE

파일 범위는 "권한"이다.

이 규칙이 깨지면
시스템은 반드시 붕괴한다.
