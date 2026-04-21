# NOX_AUTO_LOOP_SPEC (LOCKED)

> **LOCKED AS OF ROUND 028 — 2026-04-10**
> This spec is the authoritative contract for NOX auto-loop execution.
> No section may be removed or weakened without an explicit orchestration-structure-lock round.

## 1. Purpose

NOX orchestration의 자동 반복 실행(auto-loop) 구조를 정의한다.
현재 상태는 semi-automatic이다.
목표 상태는 controlled auto-loop이다.
full autonomous mode는 guardrail 없이 허용되지 않는다.

---

## 2. Current State vs Target State

| 항목 | Current (semi-auto) | Target (controlled auto-loop) |
|------|--------------------|-----------------------------|
| Task 생성 | 수동 | 자동 생성 + 수동 승인 |
| Executor 전달 | 수동 | 자동 전달 + 결과 수집 |
| Result 저장 | 수동 | 자동 저장 |
| Validation | 수동 확인 | 자동 validator + 수동 최종 확인 |
| Retry | 수동 | 자동 1회 + 수동 판단 |
| Rollback | 수동 | 자동 감지 + 수동 실행 |
| Stop | 수동 | 자동 조건 + 수동 override |

---

## 3. Auto-Loop Cycle

```
[1] Task 생성 (자동 또는 수동)
 |
[2] Task 검증 (contract 충족 여부) — run-round.ps1
 |-- FAIL → STOP (exit 1)
 |-- PASS
 |
[3] Executor Bridge 전달 — executor-bridge.ps1
 |-- Mode: manual → 수동 대기 (exit 0, result 미생성)
 |-- Mode: clipboard → 클립보드에서 result 읽기
 |-- Mode: file → staging 디렉터리에서 result 읽기
 |
[4] Result Contract 검증 (bridge 내부)
 |-- FAIL → STOP (exit 1)
 |-- PASS → result 자동 저장
 |
[5] Result 저장 확인 — run-round.ps1
 |-- 비어있음 → STOP (exit 1)
 |-- 정상 → 로그 기록
 |
[6] Validator 실행
 |-- FAIL → Retry 판단 (섹션 7)
 |-- PASS
 |
[7] State 갱신
 |
[8] 다음 Task 존재 여부
 |-- YES → [1]로 복귀
 |-- NO → STOP
```

---

## 3.1 Executor Bridge Flow

run-round.ps1은 result 파일이 존재하지 않을 때 executor-bridge.ps1을 호출한다.

### Bridge Modes

| Mode | 동작 | Result 생성 | 자동화 수준 |
|------|------|------------|-----------|
| manual | 수동 안내 출력 후 종료 | 수동 | semi-auto |
| clipboard | 클립보드에서 result 읽기 → 저장 | 자동 | controlled |
| file | staging 디렉터리에서 result 읽기 → 저장 | 자동 | controlled |

### 호출 방법

```powershell
# manual (기본값)
.\orchestration\scripts\run-round.ps1 -TaskFile <path>

# clipboard mode
.\orchestration\scripts\run-round.ps1 -TaskFile <path> -BridgeMode clipboard

# file mode (staging 디렉터리에 result 사전 배치 필요)
.\orchestration\scripts\run-round.ps1 -TaskFile <path> -BridgeMode file

# auto-loop mode (loop controller가 consecutive fail count를 전달)
.\orchestration\scripts\run-round.ps1 -TaskFile <path> -BridgeMode file -ConsecutiveFails <n>
```

### `-ConsecutiveFails` 파라미터

- Type: `int`, Default: `0`
- Auto-loop controller가 이전 라운드 연속 실패 횟수를 전달한다.
- 값이 2 이상이면 run-round.ps1은 즉시 exit 1하고 실행을 거부한다.
- 이 파라미터는 Stop Condition 9.1 ("validator가 2회 연속 FAIL")을 스크립트 레벨에서 강제한다.
- 수동 실행 시 생략 가능 (default 0으로 동작).

### Staging 경로 (file mode)

- 디렉터리: `C:\work\nox\orchestration\staging\`
- 파일명: result 파일명과 동일 (예: `round-030-result.md`)

### Fallback 규칙

- executor-bridge.ps1이 존재하지 않으면 → 수동 모드 안내 출력 (기존 동작)
- bridge 실행 중 오류 발생 → 수동 모드 안내 출력 + exit 1
- bridge가 빈 result를 생성 → exit 1
- manual mode는 result를 생성하지 않음 → 정상 종료 (수동 대기)

### 안전 장치

- bridge는 기존 result 파일이 있으면 실행 거부 (덮어쓰기 방지)
- bridge는 result contract (4개 필수 섹션) 검증 후 저장
- bridge는 task content를 읽기만 함 (수정 불가)
- full autonomous executor 호출 없음 (guardrail 준수)

---

## 4. Task Contract (LOCKED)

모든 task 파일은 아래 섹션을 반드시 포함해야 한다.

| 섹션 | 필수 | 설명 |
|------|------|------|
| [ROUND] | 필수 | 라운드 번호 |
| [TASK TYPE] | 필수 | 작업 유형 |
| [OBJECTIVE] | 필수 | 작업 목적 (1줄) |
| [TARGET FILE] 또는 [TARGET FILES] | 필수 | 수정 대상 파일 |
| [ALLOWED_FILES] | 필수 | 수정 허용 파일 목록 |
| [FORBIDDEN_FILES] | 필수 | 수정 금지 파일 목록 |
| [CONSTRAINTS] | 필수 | 제약 조건 |
| [FAIL IF] | 필수 | 실패 조건 |
| [OUTPUT FORMAT] | 필수 | 출력 형식 |

하나라도 누락 시 task는 실행 불가. validator가 즉시 REJECT.

---

## 5. Result Contract (LOCKED)

모든 result 출력은 아래 섹션을 반드시 포함해야 한다.

| 섹션 | 필수 | 설명 |
|------|------|------|
| FILES CHANGED | 필수 | 변경된 파일 목록 |
| ROOT CAUSE | 필수 | 변경 사유 |
| EXACT DIFF | 필수 | 변경 내용 요약 |
| VALIDATION | 필수 | 검증 결과 |

하나라도 누락 시 result는 유효하지 않음. validator가 FAIL 판정.

---

## 6. Validator Contract (LOCKED)

Validator는 아래 항목을 자동으로 검사한다.

### 6.1 Task 검증

- [x] 모든 필수 섹션 존재
- [x] ALLOWED_FILES에 나열된 파일만 변경됨
- [x] FORBIDDEN_FILES에 나열된 파일이 변경되지 않음
- [x] TASK TYPE과 실제 작업이 일치

### 6.2 Result 검증

- [x] FILES CHANGED 섹션 존재
- [x] ROOT CAUSE 섹션 존재
- [x] EXACT DIFF 섹션 존재
- [x] VALIDATION 섹션 존재
- [x] 변경된 파일이 ALLOWED_FILES 범위 내

### 6.3 Scope 검증

- [x] ALLOWED_FILES 범위를 초과하는 변경 없음
- [x] FORBIDDEN_FILES에 해당하는 변경 없음
- [x] single-file task에서 multi-file 변경 없음
- [x] role/scope contract와 실제 코드의 불일치 없음
- [x] config 파일 무단 변경 없음

### 6.4 Fail 판정 조건

아래 중 하나라도 해당되면 FAIL:
- allowed scope violation
- forbidden file modification
- output format 누락
- role/scope contract mismatch
- multi-file expansion on single-file task
- config modification

### 6.5 Enforcement Level Classification

Validator와 run-round.ps1의 실패 조건은 3단계로 분류된다.

| Level | 이름 | 동작 | 자동 retry | 실행 주체 |
|-------|------|------|-----------|----------|
| BLOCK | 즉시 차단 | exit 1 + 로그 기록 | 불가 | run-round.ps1 |
| WARN → BLOCK | 경고 후 차단 | 로그 기록 + 실행 중단 | 불가 | validator |
| MANUAL_REVIEW | 수동 검토 | 로그 기록 + 대기 | 1회 허용 | validator + 수동 |

#### BLOCK — 실행 전 자동 차단 (run-round.ps1)

- Task 필수 섹션 누락 (9개 중 하나라도)
- FORBIDDEN_FILES 변경 감지
- Config 파일 무단 변경 감지
- Result 파일 존재하나 비어있음
- Result 필수 섹션 누락 (4개 중 하나라도)
- state.json 누락 또는 파싱 실패

→ 즉시 중단. retry 불가. 수동 수정 후 재실행.

#### WARN → BLOCK — 실행 후 validator 차단

- ALLOWED_FILES 범위 초과
- Single-file task에서 multi-file 변경
- Role/scope contract 불일치

→ 로그에 경고 기록 후 FAIL 판정. retry 불가.

#### MANUAL_REVIEW — 자동 판정 불가

- OUTPUT FORMAT 부분 누락 (minor format issue)
- OBJECTIVE-실행 범위 불일치 의심

→ 자동 retry 1회 허용. retry 후에도 FAIL이면 auto-loop 중단, 수동 판단 전환.

---

## 7. Retry Rules

| 항목 | 규칙 |
|------|------|
| 자동 retry 횟수 | 최대 1회 |
| retry 조건 | validator FAIL이고 원인이 output format 누락 또는 minor scope issue |
| retry 불가 조건 | forbidden file 변경, config 변경, role contract 위반 |
| retry 후에도 FAIL | 수동 판단으로 전환. auto-loop 중단 |

---

## 8. Rollback Rules

| 항목 | 규칙 |
|------|------|
| 자동 rollback | 지원하지 않음 |
| rollback 판단 | validator FAIL 시 수동으로 판단 |
| rollback 방법 | git revert 또는 수동 파일 복원 |
| rollback 범위 | 해당 라운드에서 변경된 파일만 |
| rollback 후 상태 | 이전 라운드 완료 시점으로 복원 |

---

## 9. Stop Conditions

auto-loop는 아래 조건에서 즉시 중단된다.

| # | 조건 |
|---|------|
| 1 | validator가 2회 연속 FAIL |
| 2 | forbidden file이 변경됨 |
| 3 | config 파일이 변경됨 |
| 4 | 다음 task가 존재하지 않음 |
| 5 | 수동 stop 명령 (telegram 또는 직접) |
| 6 | executor가 REJECT 반환 |
| 7 | state.json 무결성 검증 실패 |

---

## 10. Guardrail Summary

| 항목 | 규칙 |
|------|------|
| Full autonomous mode | 금지 (guardrail 없이) |
| Auto-loop 최대 연속 실행 | 수동 승인 없이 최대 5 round |
| 5 round 초과 시 | 수동 검토 필수 |
| Forbidden file 변경 감지 | 즉시 중단 |
| Config 변경 감지 | 즉시 중단 |
| Product code 무단 변경 | 즉시 중단 |

---

## 11. Auto-Loop Entry Checklist

Auto-loop 진입 전 아래 항목을 모두 확인해야 한다.

### 11.1 사전 조건 (Preconditions)

| # | 항목 | 확인 방법 |
|---|------|----------|
| 1 | state.json이 존재하고 파싱 가능 | run-round.ps1 기동 시 자동 확인 |
| 2 | 첫 번째 task 파일이 존재 | task 파일 경로 유효성 확인 |
| 3 | Task contract 9개 섹션 모두 존재 | run-round.ps1 task validation |
| 4 | FORBIDDEN_FILES 목록이 명시됨 | task 파일 내 섹션 확인 |
| 5 | BridgeMode가 manual이 아님 (자동화 시) | -BridgeMode clipboard 또는 file |
| 6 | executor-bridge.ps1이 존재 (자동화 시) | 파일 존재 여부 확인 |
| 7 | staging 디렉터리 존재 (file mode 시) | orchestration/staging/ 확인 |
| 8 | ConsecutiveFails = 0 (초기 진입 시) | loop controller 초기화 |

### 11.2 루프 진행 조건 (Continuation Conditions)

| # | 항목 | 규칙 |
|---|------|------|
| 1 | ConsecutiveFails < 2 | 2회 연속 FAIL 시 즉시 중단 |
| 2 | 다음 task 파일이 존재 | 없으면 정상 종료 |
| 3 | 이전 round가 PASS | FAIL 시 retry 또는 중단 |
| 4 | round 누적 횟수 <= 5 | 5회 초과 시 수동 검토 |

### 11.3 Loop Controller 책임

Loop controller (자동화 스크립트 또는 수동 오퍼레이터)는 아래를 수행해야 한다:
- 각 round 후 validator 결과를 확인하여 ConsecutiveFails를 갱신한다.
- PASS 시 ConsecutiveFails를 0으로 리셋한다.
- FAIL 시 ConsecutiveFails를 1 증가시킨다.
- 다음 run-round.ps1 호출 시 `-ConsecutiveFails` 값을 전달한다.
- 5 round 초과 전에 수동 검토를 수행한다.

### 11.4 Manual Stop 방법

| 방법 | 동작 |
|------|------|
| Ctrl+C / 프로세스 종료 | 현재 round 중단. 결과 미저장 가능성 있음 |
| ConsecutiveFails >= 2 전달 | run-round.ps1이 실행 거부 (안전 중단) |
| 다음 task 파일 미배치 | loop controller가 정상 종료 처리 |
| Telegram stop 명령 | loop controller가 중단 신호 수신 후 종료 |
