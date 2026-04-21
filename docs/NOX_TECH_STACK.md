# NOX TECH STACK (LOCKED)

## 0. PURPOSE
이 문서는 NOX 프로젝트의 기술 스택을 고정한다.

기술 스택이 잠기지 않으면
같은 기능도 서로 다른 방식으로 구현되어 구조가 깨질 수 있다.

따라서 이 문서는
프론트엔드, 백엔드, 인증, 데이터, 실시간 통신, 테스트, 배포의 기준을 고정한다.

---

## 1. FRONTEND

### 1.1 Framework
- Expo
- React Native
- TypeScript
- Expo Router

### 1.2 UI Direction
- 모바일 우선
- Android 우선 검증
- 이후 iOS 확장 고려
- 단순하고 빠른 운영 UI 우선

### 1.3 Styling
- React Native 기본 스타일 기반
- 공통 UI 컴포넌트 방식
- MVP에서는 과도한 디자인 시스템 금지

---

## 2. BACKEND

### 2.1 Backend Platform
- Supabase

### 2.2 Database
- PostgreSQL (Supabase managed)

### 2.3 API Strategy
- Supabase 기반 데이터 접근
- 필요 시 서버 함수 / API 레이어 추가
- 서버에서 정산 계산 수행

### 2.4 Storage
- Supabase Storage 사용 가능
- MVP에서는 핵심 기능 외 업로드 기능 최소화

---

## 3. AUTHENTICATION

### 3.1 Auth Provider
- Supabase Auth

### 3.2 Auth Scope
- 회원가입
- 로그인
- 승인 대기
- 승인 후 접근 허용

### 3.3 Role Model
- owner
- manager
- hostess

### 3.4 Security Principle
- 인증 없는 쓰기 금지
- 승인 안 된 계정 차단
- store_uuid 기준 접근 제한

---

## 4. DATA MODEL PRINCIPLES

### 4.1 Core Identity
- session_id = runtime identity
- room_uuid = canonical room identity
- store_uuid = security scope
- room_no = display only
- business_date = operational aggregation key

### 4.2 Server Truth
- 금액 계산은 서버 기준
- 화면은 계산 결과만 표시
- 핵심 상태는 DB 기준

---

## 5. REALTIME / UPDATE STRATEGY

### 5.1 MVP Default
- 초기 MVP는 단순하고 안정적인 방식 우선
- polling 또는 Supabase realtime 중 하나를 선택

### 5.2 Rule
- 실시간 방식은 문서로 잠근 후 사용
- UI마다 제각각 구현 금지

---

## 6. LOGGING / OBSERVABILITY

### 6.1 Minimum Logging
- 핵심 액션 로그
- 세션 로그
- 정산 로그
- 오류 로그

### 6.2 Rule
- 누가 생성/수정/종료했는지 추적 가능해야 함
- 최소 로그 구조는 MVP부터 포함

---

## 7. TESTING

### 7.1 Minimum Test Scope
- 회원가입/로그인
- 승인 흐름
- room 생성/조회
- 세션 생성/종료
- 정산 계산
- cross-store 차단

### 7.2 Test Principle
- 중요한 로직은 수동 확인만으로 끝내지 않음
- PASS / FAIL 기준 명확화

---

## 8. DEPLOYMENT DIRECTION

### 8.1 Development
- 로컬 개발 우선
- Android 실기기 우선 테스트

### 8.2 Future Direction
- 이후 iOS 빌드/배포 고려
- 앱 배포는 MVP 안정화 후 단계적으로 진행

---

## 9. EXCLUDED FROM EARLY MVP

- BLE 구현
- 채팅 구현
- 다층 대규모 구조
- 고급 리포트
- 복잡한 오프라인 동기화
- 고급 알림 시스템

---

## 10. FINAL RULE

NOX의 기술 스택은
"지금 빨리 보이게 만드는 선택"이 아니라
"나중에 앱으로 확장해도 안 무너지는 선택"을 기준으로 한다.
