# NOX_ORCHESTRATION_EXECUTION_RULES (LOCKED)

> **LOCKED AS OF ROUND 028 — 2026-04-10**
> This document is the execution-rule contract for NOX_AUTO_LOOP_SPEC.
> No section may be removed or weakened without an explicit orchestration-structure-lock round.

## 1. Purpose

NOX orchestration의 task 실행, result 판정, scope 보호 규칙을 정의한다.
이 문서는 NOX_AUTO_LOOP_SPEC의 실행 규칙 계약이다.

---

## 2. Task Execution Rules

### 2.1 Task 수신

- Executor는 task 파일을 수신한다.
- Task 파일에 필수 섹션이 누락되면 실행하지 않는다.
- 필수 섹션: ROUND, TASK TYPE, OBJECTIVE, TARGET FILE(S), ALLOWED_FILES, FORBIDDEN_FILES, CONSTRAINTS, FAIL IF, OUTPUT FORMAT.

### 2.2 Scope 준수

- Executor는 ALLOWED_FILES에 나열된 파일만 수정한다.
- FORBIDDEN_FILES에 나열된 파일은 읽기만 허용된다. 쓰기 금지.
- single-file task에서 2개 이상 파일을 수정하면 FAIL.
- ALLOWED_FILES에 없는 파일을 생성하면 FAIL.

### 2.3 실행 범위

- Executor는 OBJECTIVE에 명시된 작업만 수행한다.
- 추측 금지. 명시되지 않은 기능 추가 금지.
- Unrelated refactor 금지.
- Helper, utility, abstraction 무단 생성 금지.

### 2.4 실행 완료

- 실행 완료 후 result를 출력한다.
- Result는 OUTPUT FORMAT에 정의된 형식을 따른다.
- FAIL IF 조건에 해당하면 REJECT를 반환한다.

---

## 3. Result Judgment Rules

### 3.1 PASS 조건

모든 아래 조건을 동시에 만족해야 PASS:
- FILES CHANGED가 ALLOWED_FILES 범위 내
- FORBIDDEN_FILES 변경 없음
- OUTPUT FORMAT 섹션 전부 존재 (FILES CHANGED, ROOT CAUSE, EXACT DIFF, VALIDATION)
- FAIL IF 조건에 해당하지 않음
- Role/scope contract 불일치 없음

### 3.2 FAIL 조건

아래 중 하나라도 해당되면 FAIL:
- ALLOWED_FILES 범위 초과
- FORBIDDEN_FILES 변경
- OUTPUT FORMAT 누락
- FAIL IF 조건 해당
- Config 파일 변경
- Role/scope contract 불일치
- Single-file task에서 multi-file 변경

### 3.2.1 Enforcement Level Classification

모든 FAIL 조건은 아래 3단계 중 하나로 분류된다.

| Level | 이름 | 동작 | 자동 retry |
|-------|------|------|-----------|
| BLOCK | 즉시 차단 | 실행 중단 + exit 1 | 불가 |
| WARN → BLOCK | 경고 후 차단 | 로그 기록 + 실행 중단 | 불가 |
| MANUAL_REVIEW | 수동 검토 | 로그 기록 + 수동 판단 대기 | 1회 허용 |

#### BLOCK (즉시 차단) — run-round.ps1이 자동 차단

| # | 조건 | 근거 |
|---|------|------|
| 1 | Task 필수 섹션 누락 | Task contract 미충족 → 실행 불가 |
| 2 | FORBIDDEN_FILES 변경 | Scope contract 위반 |
| 3 | Config 파일 무단 변경 | Scope protection 위반 |
| 4 | Result 파일 존재하나 비어있음 | 무효 상태 |
| 5 | Result 필수 섹션 누락 (FILES CHANGED, ROOT CAUSE, EXACT DIFF, VALIDATION) | Result contract 미충족 |

#### WARN → BLOCK (경고 후 차단) — validator가 감지 후 차단

| # | 조건 | 근거 |
|---|------|------|
| 1 | ALLOWED_FILES 범위 초과 | Scope 위반이나 실행 후 감지 |
| 2 | Single-file task에서 multi-file 변경 | Task type 불일치 |
| 3 | Role/scope contract 불일치 | 실행 결과 검증 시 감지 |

#### MANUAL_REVIEW (수동 검토) — 자동 판정 불가

| # | 조건 | 근거 |
|---|------|------|
| 1 | OUTPUT FORMAT 부분 누락 (내용은 있으나 형식 불일치) | Minor format issue → retry 1회 후 수동 |
| 2 | OBJECTIVE와 실제 작업 범위 불일치 의심 | 자동 판정 어려움 |
| 3 | Retry 1회 후에도 FAIL | 자동 해결 불가 → 수동 전환 |

### 3.3 REJECT 조건

Executor가 실행 전에 REJECT를 반환할 수 있는 경우:
- Task 필수 섹션 누락
- OBJECTIVE가 현재 코드 상태로 실행 불가
- 단일 변경으로 완료 불가하여 연쇄 수정 필요
- 기존 LOCKED 문서와 충돌

---

## 4. Scope Protection Rules

### 4.1 File Scope

| 구분 | 규칙 |
|------|------|
| ALLOWED_FILES | 수정 허용. 이 목록에 있는 파일만 변경 가능 |
| FORBIDDEN_FILES | 수정 금지. 읽기만 허용 |
| 미언급 파일 | 수정 금지. ALLOWED에 없으면 변경 불가 |

### 4.2 Config Scope

아래 파일은 명시적 허용 없이 변경 금지:
- state.json
- orchestrator.config.json
- package.json
- package-lock.json
- tsconfig.json
- next.config.js

### 4.3 Product Scope

orchestration task에서 product code(app/, lib/) 변경 금지.
product task에서 orchestration code(orchestration/) 변경 금지.
교차 변경이 필요하면 별도 라운드로 분리.

---

## 5. Executor Handoff Rules

### 5.1 Handoff 순서

1. Orchestrator가 task 파일을 생성/선택한다.
2. run-round.ps1이 task를 executor에게 전달한다.
3. Executor가 실행하고 result를 반환한다.
4. Result가 result 파일에 저장된다.
5. Validator가 result를 검증한다.
6. PASS 시 state 갱신. FAIL 시 retry 또는 stop.

### 5.2 Executor 식별

- Primary executor: claude_code
- Secondary executors: cursor, codex
- Executor는 task 파일의 CONSTRAINTS를 따른다.
- Executor 간 동일 task 중복 실행 금지.

---

## 6. Result Persistence Rules

### 6.1 Result 파일

- 경로: orchestration/results/{round}-{name}-result.md
- 형식: OUTPUT FORMAT 섹션 기준
- 인코딩: UTF-8 without BOM

### 6.2 Log 파일

- 경로: orchestration/logs/{round}-{name}.log
- 내용: timestamp, task file, result file, state snapshot
- 인코딩: UTF-8 without BOM

### 6.3 보존 규칙

- Result 파일은 삭제하지 않는다.
- Log 파일은 삭제하지 않는다.
- 덮어쓰기 전에 기존 파일 존재 여부를 확인한다.

---

## 7. Prohibited Patterns

| # | 금지 패턴 |
|---|---------|
| 1 | Task 없이 executor 직접 실행 |
| 2 | FORBIDDEN_FILES 우회 변경 |
| 3 | Result 없이 state 갱신 |
| 4 | Validator 없이 PASS 판정 |
| 5 | Guardrail 없이 autonomous 실행 |
| 6 | 단일 round에서 product + orchestration 동시 변경 |
| 7 | Retry 2회 이상 자동 실행 |
| 8 | Rollback 없이 FAIL 무시 |

---

## 8. Auto-Loop Continuation Rules

### 8.1 Exit Code Contract

run-round.ps1은 아래 exit code를 반환한다.
Loop controller는 이 exit code를 기반으로 다음 동작을 결정한다.

| Exit Code | 의미 | Loop controller 동작 |
|-----------|------|---------------------|
| 0 | 정상 완료 (result 존재 또는 manual 대기) | ConsecutiveFails 유지 또는 0 리셋 후 계속 |
| 1 | 실패 (task/result contract, scope, bridge 오류 등) | ConsecutiveFails +1 후 retry 또는 중단 판단 |

### 8.2 ConsecutiveFails 갱신 규칙

| 상황 | ConsecutiveFails 갱신 |
|------|----------------------|
| Validator PASS | 0으로 리셋 |
| Validator FAIL (MANUAL_REVIEW → retry 허용) | +1 (retry 후 재판정) |
| Validator FAIL (BLOCK / WARN→BLOCK) | +1 (retry 불가, 중단 판단) |
| run-round.ps1 exit 1 (contract 위반 등) | +1 |
| run-round.ps1 exit 0, manual 대기 중 | 변경 없음 |

### 8.3 ConsecutiveFails >= 2 처리

- run-round.ps1이 `-ConsecutiveFails 2` 이상을 받으면 즉시 exit 1.
- 로그에 "consecutive fail limit reached" 기록.
- Loop controller는 auto-loop를 중단하고 수동 검토 대기.
- 재개 방법: 원인 수정 후 `-ConsecutiveFails 0`으로 재호출.

### 8.4 Round 누적 한도

- Loop controller는 수동 승인 없이 최대 5 round를 연속 실행할 수 있다.
- 5 round 초과 전에 반드시 수동 검토를 수행한다.
- 검토 후 계속 진행하려면 loop controller를 재시작한다.

### 8.5 Auto-Loop vs Semi-Auto 모드 구분

| 모드 | BridgeMode | ConsecutiveFails 전달 | Result 생성 |
|------|-----------|----------------------|------------|
| semi-auto (수동) | manual | 생략 (default 0) | 수동 |
| controlled auto-loop | clipboard 또는 file | 필수 전달 | 자동 |

Full autonomous 모드는 guardrail 없이 허용되지 않는다.
Controlled auto-loop는 위 규칙을 모두 준수할 때만 허용된다.
