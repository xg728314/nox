# NOX PRODUCT REQUIREMENTS (LOCKED)

## 0. PURPOSE
이 문서는 NOX 시스템의 제품 요구사항을 정의한다.

NOX는 유흥업소/룸 운영 환경에서
종이 장부와 수기 정산을 대체하는 실시간 운영 시스템이다.

이 문서는 MVP 기준 범위와 제외 범위를 명확히 정의하며,
모든 개발은 이 문서를 기준으로 진행된다.

---

## 1. DEVELOPMENT STRATEGY

### 핵심 전략
작게 완성 → 검증 → 복제 → 확장

### 금지 전략
전체 완성형을 먼저 만들고 나중에 안정화 ❌

---

## 2. MVP CORE SCENARIO

다음 시나리오가 정상 동작하면 1차 MVP 완료로 본다.

1. owner 로그인
2. 1번 방 선택
3. 세션 생성
4. 손님 수 등록
5. 아가씨 1명 등록
6. 담당 실장 연결
7. 양주 1병 추가
8. 시간 진행
9. 세션 종료
10. 정산 결과 확인

---

## 3. MVP COMPLETION CONDITIONS

다음 조건을 모두 만족해야 MVP 완료:

1. 회원가입 가능
2. 승인 가능
3. 로그인 가능
4. 방 1~2개 운영 가능
5. 세션 생성 가능
6. 참여자 등록 가능
7. 시간 기록 가능
8. 기본 정산 가능
9. 종료 가능
10. 최소 권한 분리 가능

---

## 4. MVP SCOPE (INCLUDED)

### 4.1 계정
- 회원가입
- 로그인
- 승인
- 기본 권한 (owner / manager / hostess)

### 4.2 조직 구조
- store 1개
- floor 최소 1개
- room 1~2개
- room 상태 (empty / occupied)

### 4.3 세션
- 세션 생성
- 세션 종료
- 참여자 등록
- 참여자 제거
- 시간 기록

### 4.4 참여자
- 손님: headcount 또는 익명
- 아가씨
- 실장

### 4.5 오더
- 양주 / 맥주 / 음료 추가
- 재고 추적 없음

### 4.6 정산
- 시간 기반 계산
- 기본 요금표 1개
- 손님 금액
- 아가씨 지급
- 실장 몫
- owner 수익

### 4.7 UI
- 로그인
- 회원가입
- 승인 대기
- room grid
- 세션 상세
- 참여자 추가
- 정산 화면

### 4.8 로그
- 최소 행위 로그
- 세션 로그
- 정산 로그

### 4.9 보안
- 인증 없는 쓰기 차단
- store_uuid 범위 차단
- 종료 세션 수정 차단

---

## 5. MVP SCOPE (EXCLUDED)

다음 기능은 MVP에서 제외:

- BLE
- 채팅
- 다층 구조 (5~8층)
- 다매장 SaaS
- 고급 권한
- 고급 정산 리포트
- 재고 관리
- OTA
- 고급 알림
- 복잡한 오프라인 동기화

---

## 6. CORE DOMAIN DEFINITIONS

### 6.1 IDENTIFIERS

- session_id = runtime identity
- room_uuid = canonical room identity
- store_uuid = security scope
- room_no = display only

---

### 6.2 CUSTOMER

- 로그인 계정 아님
- headcount 또는 익명 participant

---

### 6.3 BUSINESS_DATE

- 영업일 기준 집계
- calendar date와 분리
- 모든 세션/정산은 business_date 포함

---

### 6.4 SETTLEMENT STRUCTURE

기본 공식:

customer_payment
- hostess_payout
- manager_share
= owner_profit

---

### 6.5 ORDER STRUCTURE

- 오더 기록만 관리
- 재고 관리 없음

---

## 7. UI PRINCIPLES

- 모바일 우선
- 단순 구조
- 버튼 최소화
- 상태 즉시 표시
- 계산은 서버에서 수행

---

## 8. SECURITY BASELINE

- 모든 쓰기 요청 인증 필요
- store_uuid 기반 접근 제한
- 권한 없는 API 차단
- 서버에서 금액 계산
- 민감정보 최소 반환

---

## 9. DATA MODEL (CORE TABLES)

- users
- store_memberships
- stores
- floors
- rooms
- sessions
- session_participants
- settlements
- menu_items
- orders
- action_logs

---

## 10. DEVELOPMENT ORDER

반드시 아래 순서로 진행:

1. DB
2. API
3. UI
4. Validation

---

## 11. FINAL RULE

이 문서에 없는 기능은 MVP에서 만들지 않는다.

이 문서의 범위를 벗어나면 실패다.
