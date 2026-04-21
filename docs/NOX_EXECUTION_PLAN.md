# NOX EXECUTION PLAN (LOCKED)

## 0. PURPOSE
이 문서는 NOX 프로젝트의 실제 작업 순서를 고정한다.
모든 개발은 이 문서의 STEP 순서를 따른다.

핵심 원칙:
- STEP 순서 임의 변경 금지
- STEP 완료 전 다음 STEP 진입 금지
- DB → API → UI → Validation 순서 고정
- 1차 MVP는 직렬 중심 진행
- STEP 0 잠금 문서 완료 전 STEP 1 금지

---

## 1. MASTER EXECUTION STRATEGY

### 1.1 핵심 전략
작게 완성 → 검증 → 복제 → 확장

### 1.2 MVP 우선
1차는 1룸 1세션 1정산이 정확히 돌아가는 것을 목표로 한다.

### 1.3 확장 금지
MVP 완료 전 아래 기능 선구현 금지:
- BLE
- 채팅
- 다층 전체
- 대규모 다매장
- 고급 권한
- 고급 리포트
- 고급 운영도구

---

## 2. STEP 0 — 방향 고정 및 핵심 정의 잠금

### 목표
실제 구현 전에 흔들릴 수 있는 핵심 정의를 문서로 잠근다.

### 반드시 잠글 것
- 서비스 목적
- 1차 범위
- 1차 제외 항목
- 용어 사전
- 역할 최소 정의
- 기술 스택
- MVP 핵심 ERD
- business_date 정의
- customer 정체
- 실장 정산 공식 최소 1개
- 품목 범위 (오더 기록만)
- 실시간 업데이트 방식
- 기본 보안 원칙
- FILE_SCOPE 규칙
- NO_TOUCH 규칙
- 완료 기준 체크리스트

### 산출물
- NOX_MASTER_RULES.md
- NOX_ORCHESTRATOR_RULES.md
- NOX_TASK_SCHEMA.md
- NOX_PRODUCT_REQUIREMENTS.md
- NOX_TECH_STACK.md
- NOX_GLOSSARY.md
- NOX_ERD_MVP.md
- NOX_PRICING_RULE.md
- NOX_BUSINESS_DATE_RULE.md
- NOX_SECURITY_BASELINE.md
- NOX_FILE_SCOPE.md
- NOX_NO_TOUCH.md
- NOX_DONE_CHECKLIST.md

### 완료 조건
- 핵심 정의 문서화 완료
- 모순 없는지 검토 완료
- STEP 1 진입 승인 가능

---

## 3. STEP 1 — 계정 / 인증 / 승인

### 목표
회원가입, 로그인, 승인, 기본 권한 흐름을 완성한다.

### 포함
- users
- store_memberships
- 회원가입 API
- 로그인 API
- 승인 처리
- 승인 대기 화면
- 로그아웃
- 기본 role check

### 보안 필수
- 미승인 계정 차단
- 인증 없는 쓰기 금지
- store_uuid 연결

### 산출물
- migration
- seed
- auth middleware
- 회원가입 화면
- 로그인 화면
- 승인 대기 화면
- 검증 결과

### 완료 조건
- 회원가입 성공
- 승인 성공
- 로그인 성공
- 미승인 차단 정상
- 쓰기 API 인증 필수 적용

---

## 4. STEP 2 — 조직 구조

### 목표
store / floor / room 구조를 MVP 범위로 고정한다.

### 포함
- stores
- floors
- rooms
- room_uuid / room_no / room_name
- room 상태
- 최소 설정 UI

### 핵심 규칙
- store_uuid 보안 범위 유지
- room_no는 표시용만
- room_uuid만 canonical identity

### 산출물
- migration
- CRUD API
- 설정 UI
- seed room 1~2개

### 완료 조건
- room 생성/조회 가능
- room 상태 반영 가능
- cross-store 차단 유지

---

## 5. STEP 3 — 세션 엔진 + 세션 UI

### 목표
1룸에서 1세션이 정상 생성/운영/종료되게 한다.

### 포함
- sessions
- session_participants
- 세션 생성
- 참여자 등록
- 참여자 제거
- 세션 종료
- 세션 상세 화면
- room grid 최소형

### 핵심 규칙
- session_id 기준 동작
- 같은 방 중복 세션 방지
- 종료 세션 수정 제한
- business_date 반영

### 완료 조건
- room에서 세션 생성 가능
- 손님/아가씨/실장 연결 가능
- 종료 가능
- 세션 상태 화면 반영 가능

---

## 6. STEP 4 — 정산 엔진 + 정산 UI

### 목표
최소 정산 공식을 서버에서 안전하게 계산한다.

### 포함
- settlements
- menu_items
- orders
- 시간 계산
- 기본 요금표 1개
- 오더 추가
- customer_payment
- hostess_payout
- manager_share
- owner_profit
- 정산 화면

### 핵심 규칙
- 돈 계산은 서버에서만
- pricing rule과 실제 로직 일치
- idempotency 고려
- 이상값 방지

### 완료 조건
- 세션 종료 후 정산 계산 가능
- 오더 반영 가능
- 정산 수치 화면 표시 가능
- 중복 저장 방지 기본 구조 존재

---

## 7. STEP 5 — 홈 + 로그 + 권한 검증

### 목표
운영 최소 홈과 검증 가능한 로그 구조를 만든다.

### 포함
- owner 홈 최소형
- action logs
- 세션 로그
- 정산 로그
- 권한 검증
- cross-store 차단 검증
- 종료 세션 수정 차단 검증

### 완료 조건
- 홈에서 방 상태 확인 가능
- 핵심 액션 로그 확인 가능
- 권한 차단 확인 가능
- STEP 1~5 전체 PASS

### 결과
여기까지를 1차 MVP 완료로 본다.

---

## 8. STEP 6 — 출근 / 배정

### 목표
운영형 기능으로 확장한다.

### 포함
- 출근/퇴근
- available / assigned / in_room / off_duty
- primary manager
- shared manager 최소 구조
- 배정 현황판

---

## 9. STEP 7 — 정산 고도화

### 포함
- 복수 요금표
- 반타임/추가시간
- 품목 확장
- 정산 수정/재계산
- 일간 집계

---

## 10. STEP 8 — 운영 UI 확장

### 포함
- manager 홈
- hostess 홈
- 승인 처리 화면
- 출근/배정 화면
- 정산 이력 화면

---

## 11. STEP 9 — 로그 / 보안 / 예외 처리 강화

### 포함
- 입력 검증 강화
- 중복 요청 방지
- 상태 전이 검증
- 민감정보 분리
- 마감 후 수정 제한
- 정책 강화

---

## 12. STEP 10 — BLE

### 포함
- 태그 등록
- 게이트웨이 관리
- 위치 추론
- 이탈 감지

---

## 13. STEP 11 — 채팅

### 포함
- 1:1
- 그룹
- 방/세션별 채팅
- 공지

---

## 14. STEP 12 — 리포트 / 마감 / 감사

### 포함
- 리포트
- 마감
- reopen / rollback
- 감사 로그 확장

---

## 15. STEP 13 — 운영도구 / 모니터링

### 포함
- 관리자 관제
- 모니터링
- 운영툴

---

## 16. STEP 14 — SaaS 준비

### 포함
- 다매장 구조
- 테넌트 확장
- SaaS 운영 준비

---

## 17. STEP ORDER RULES

### 절대 규칙
- STEP 0 완료 전 STEP 1 금지
- STEP 1 완료 전 STEP 2 금지
- STEP 2 완료 전 STEP 3 금지
- STEP 3 완료 전 STEP 4 금지
- STEP 4 완료 전 STEP 5 금지

### 병렬 원칙
1차 MVP는 기본 직렬
병렬은 문서/체크리스트/탐색 수준에서만 제한 허용

---

## 18. LAYER ORDER RULES

모든 STEP 안의 구현 순서는 아래 고정:

1. DB
2. API
3. UI
4. Validation

DB 스키마 잠금 전 API 금지
API 스펙 잠금 전 UI 금지

---

## 19. STEP 1 ENTRY CHECK

아래가 모두 YES여야 STEP 1 진입 가능:

1. 서비스 목적 문서화
2. 1차 범위/제외 문서화
3. 용어 사전 완료
4. 역할 최소 정의 완료
5. 기술 스택 확정
6. MVP ERD 잠금
7. customer 정체 확정
8. business_date 규칙 확정
9. 실장 정산 공식 1개 확정
10. 품목 범위 확정
11. 실시간 업데이트 방식 확정
12. 기본 보안 원칙 문서화
13. FILE_SCOPE / NO_TOUCH 준비
14. 완료 체크리스트 준비

하나라도 NO면 STEP 1 금지.

---

## 20. FINAL RULE

이 문서는 NOX의 공정표다.
작업이 많아도 순서를 바꾸지 않는다.
방향이 흔들리면 이 문서로 되돌아간다.
