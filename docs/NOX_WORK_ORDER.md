# NOX WORK ORDER (LOCKED)
이 문서는 작업 순서와 완료 기준을 정의한다.
순서 변경 금지. 각 PHASE 완료 검증 후 다음 진입.

## PHASE 1: 기반 (0~10%)

### 작업 목록
- NOX Supabase 기존 테이블 전부 삭제
- 새 스키마 생성 (커서 FOXPRO87 검증 구조 기반)
  - stores
  - rooms
  - profiles
  - store_memberships
  - managers
  - hostesses
  - room_sessions
  - session_participants
  - orders
  - receipts
  - receipt_snapshots
  - closing_reports
  - store_operating_days
  - store_settings
  - audit_events
- 모든 업무 테이블 store_uuid 필수
- created_at / updated_at / deleted_at 필수
- RLS 기본 정책 적용 (store_uuid 기준)
- Supabase 클라이언트 연결 확인

### 완료 기준
- store A 유저가 store B 데이터 접근 시 403
- DB 콘솔 INSERT/SELECT 테스트 통과
- audit_events INSERT only 정책 확인

---

## PHASE 2: 인증 (10~20%)

### 작업 목록
- 회원가입 (이메일)
- 로그인
- store_memberships 기반 권한 구조
- resolveAuthContext 재구현
  - user_id / store_uuid / role / membership_id / status 반환
- 역할: owner / manager / hostess
- 승인 상태: pending / approved / rejected / suspended
- pending 상태 API 전면 차단

### 완료 기준
- pending 상태 API 접근 불가
- role별 API 접근 제한 동작
- RLS + 서버 auth 모두 통과

---

## PHASE 3: 마스터 데이터 (20~30%)

### 작업 목록
- 마블 가게 1개 등록 (store_uuid 기준)
- 룸 1개 등록 (room_uuid 기준)
- 실장 1명 등록 (membership_id 기준)
- 아가씨 1명 등록 (membership_id 기준)
- 가격표 등록 (기본 + 매장 override)
- 정산 설정 등록 (tc_rate / payout_basis / rounding_unit)
- store_operating_days 생성

### 완료 기준
- 카운터에서 룸 목록 조회 가능
- 가격표 조회 가능
- 실장/아가씨 목록 조회 가능

---

## PHASE 4: 세션 엔진 (30~50%)

### 작업 순서 (절대 고정)
1. 체크인 (session 생성 + room_uuid 연결)
2. 참가자 등록 (아가씨 + 실장 배정 + 종목 선택)
3. 주문 추가 (서버에서만 가격 계산)
4. 연장
5. 중간 아웃
6. 체크아웃 (session 종료)
7. 정산 계산 (서버 함수 전용)
   - 입력: orders + participants + store_settings
   - 출력: gross_total / tc_amount / manager_amount / hostess_amount / margin_amount
8. 영수증 생성 (receipt_snapshots)

### 완료 기준
- 1세션 E2E 테스트 통과
- 수동 계산과 서버 결과 일치
- 클라이언트 계산 로직 없음
- audit_events 기록 확인

---

## PHASE 5: 역할별 UI (50~70%)

### 카운터
- 룸 그리드 (실시간 상태)
- 세션 생성/종료
- 참가자 등록
- 주문 추가
- 체크아웃

### 실장
- 본인 세션 목록
- 아가씨 배정
- 본인 정산 조회

### 아가씨
- 본인 참여 세션
- 본인 정산 조회

### 사장
- 전체 룸 현황
- 전체 매출
- 정산 요약
- 마감 처리

### 완료 기준
- 역할별 로그인 시 다른 화면
- 동일 API 호출 시 role별 다른 결과

---

## PHASE 6: 크로스 스토어 (70~75%)

### 작업 목록
- 아가씨 가게 이동 처리 (transfer_request)
- 이동 승인 구조 (출발 + 도착 모두)
- 정산 가게별 분리
- 이동 이력 append-only 기록

### 완료 기준
- 이동 로그 기록 확인
- 두 가게 정산 데이터 분리 유지

---

## PHASE 7: 마감/리포트 (75~85%)

### 작업 목록
- 영업일 마감 처리 (business_day_id 기준)
- 마감 후 수정 제한
- 일별 / 실장별 / 아가씨별 / 매장별 리포트
- CSV 출력

### 완료 기준
- 마감 후 수정 불가
- 리포트 수치 정산 결과와 일치
- CSV 정상 출력

---

## PHASE 8: 오프라인 (85~92%)

### 작업 목록
- IndexedDB 구조 설계
- 세션 / 주문 오프라인 저장
- 온라인 복구 시 서버 전송
- 충돌 처리 (서버 우선 + conflict_pending)

### 완료 기준
- 인터넷 끊고 세션/주문 가능
- 복구 시 데이터 유지
- conflict 발생 시 사용자 확인 화면 표시

---

## PHASE 9: BLE (92~97%)

### 작업 목록
- Android Gateway 연동
- 아가씨 위치 감지
- BLE 이벤트 → 세션 자동 반영
- 오프라인 BLE 큐 → 온라인 복구 시 서버 전송

### 완료 기준
- BLE 이벤트 → 세션 반영 확인
- 오프라인 큐 정상 동작

---

## PHASE 10: 보안/안정화 (97~100%)

### 작업 목록
- RLS 전체 점검
- audit_events 전체 적용
- 모든 write에 actor 기록
- 부하 테스트
- 권한 우회 테스트

### 완료 기준
- 권한 우회 불가
- 모든 행동 로그 추적 가능
- 부하 테스트 통과

---

## 절대 규칙
- DB → API → UI 순서 고정
- 각 PHASE 완료 검증 후 다음 진입
- 마블 1룸 완성 후 확장
- 추측 기반 작업 금지
- 클라이언트 계산 금지
- store_uuid 기준 전체 유지
