# NOX PROJECT TRUTH (LOCKED v3)
절대 변경 금지. 변경 시 전체 합의 필요.

## 1. 프로젝트 목적
유흥업소 운영 디지털화.
종이 장부 / 수기 정산 / 수동 배치를 앱으로 대체.
향후 광고 플랫폼 연동 + 타 지역 확장 예정.
작업 전략: 마블 1룸 → 전체 룸 → 가게 → 층 → 전체 확장.

## 2. 실제 운영 규모
- 5~8층, 총 14개 가게
- 가게마다 실장 3~10명
- 실장마다 아가씨 10~20명
- 하루 이용 300~400명
- 가입자 2천명 이상

## 3. 층별 가게 구조
5층: 마블, 라이브, 버닝, 황진이
6층: 신세계, 아지트, 아우라, 퍼스트
7층: 상한가, 토끼, 발리, 두바이
8층: 블랙, 파티

stores 테이블 구조:
- store_uuid (PK, 절대 변경 없음)
- store_name (마블, 라이브 등 표시용)
- store_code (B, C 등 선택적 표시용, 로직 사용 금지)
- floor (5, 6, 7, 8)

금지:
- store_code를 API/DB/RLS/로그에 사용 금지
- store_code를 식별자로 사용 금지
- UI 표시에만 허용

## 4. 역할 정의 (LOCKED)
- owner: 가게 사장. 전체 조회. 마감 권한.
- manager: 세션 담당. 아가씨 배정.
- hostess: 세션 참여. 본인 정산만 조회.
- counter: UI actor (role enum 아님. delegated actor.)

counter 규칙:
- counter는 role enum에 없음
- counter는 owner/manager의 위임 UI actor
- 모든 write는 실제 로그인 user_id 기준 기록
- audit에는 actor_type: counter로 기록

## 5. 사람/소속 식별 (CRITICAL LOCK)
- user_id: 사람 고유 identity (profiles)
- membership_id: 가게 소속 고유 identity (store_memberships)
- 권한 판단은 membership 기준 (user_id 직접 사용 금지)
- manager/hostess 참조는 membership_id 기준
- 한 사람이 여러 membership 가질 수 있음 (cross-store 대비)
- active membership은 동시에 1개 (이동 시 기존 close + 신규 생성)

## 6. 핵심 식별자 (LOCKED)
- store_uuid: 보안 scope 기준. 모든 업무 테이블 필수.
- room_uuid: 룸 canonical identity
- room_no: 표시용만. 조회/로직 기준 금지.
- session_id: 세션 runtime identity
- membership_id: 소속/권한 identity
- business_day_id: 영업일 identity (calendar date 직접 사용 금지)
- transfer_request_id: 이동 승인 identity

전역 테이블 예외 (store_uuid 없음 허용):
- profiles
- auth 관련 테이블
- 시스템 설정

## 7. store_uuid 적용 규칙 (CRITICAL)
- 모든 업무 테이블은 store_uuid 필수
- cross-store: 데이터의 store_uuid는 실제 데이터 발생 가게 기준
- 사람의 원소속 store_uuid 사용 금지
- API/DB/RLS/로그: store_uuid만 사용
- UI: store_name + store_code 사용 가능

## 8. rooms 구조 (LOCKED)
- room_uuid: canonical identity (전역 unique)
- room_no: 표시용 (store 내 unique)
- room_name: 표시용
- store_uuid: 소속 가게
- floor: 층 (정보용)
- is_active: 활성 여부
- sort_order: 정렬용

금지:
- room_no로 조회/로직 기준 사용 금지
- room 이름으로 식별 금지

## 9. 세션 구조 (LOCKED)
흐름: 체크인 → 참가자 등록 → 주문 → 연장 → 체크아웃 → 정산

- session_id: 모든 정산/주문/참가의 root key
- 같은 room_uuid에 active session 중복 금지
- session 없이 정산 생성 금지
- session 없이 주문 생성 금지

session 상태: active / closed / void

## 10. participant 모델 (CRITICAL)
- participant는 membership_id 기준
- participant.store_uuid = session.store_uuid (원소속 금지)
- 필수: session_id / membership_id / role / store_uuid

## 11. business day 규칙 (CRITICAL)
- business_day_id: 영업일 canonical identity
- 영업일 기준: store_operating_days.opened_at ~ closed_at
- 자정 고정 아님. 가게별 운영 시각 기준.
- 세션/정산/마감은 business_day_id 기준
- calendar date 직접 사용 금지

## 12. 가격 체계 (LOCKED)
퍼블릭 완티: 90분 / 130,000원
퍼블릭 반티: 45분 / 70,000원
셔츠 완티: 60분 / 140,000원
셔츠 반티: 30분 / 70,000원
하퍼 완티: 60분 / 120,000원
하퍼 반티: 30분 / 60,000원
차3: 15분 / 30,000원
연장: 15분 / 30,000원

규칙:
- 가격은 DB 기반. 하드코딩 금지.
- store별 override 허용.
- 변경 이력 필수.
- 가격 변경 권한: owner/관리자만.

## 13. 정산 공식 (LOCKED)
gross_total = base_price + extra_price + orders_total
tc_amount = roundToUnit(gross_total * tcRate, roundingUnit)
base_amount = gross_total OR gross_total - tc_amount (payout_basis)
manager_amount = roundToUnit(base_amount * managerRate, roundingUnit)
hostess_amount = roundToUnit(base_amount * hostessRate, roundingUnit)
margin_amount = gross_total - tc_amount - manager_amount - hostess_amount

규칙:
- 서버에서만 계산. 클라이언트 계산 금지.
- 클라이언트 금액 입력 금지.
- 음수/할인/서비스 조정은 별도 adjust 처리.
- 주문 취소 시 정산 재계산 필수.

## 14. 정산 설정 (store_settings)
- tc_rate (기본 0.2)
- manager_payout_rate (기본 0.7)
- hostess_payout_rate (기본 0.1)
- payout_basis: gross / netOfTC
- rounding_unit (기본 1000)

## 15. settlement 모델 (LOCKED)
- settlement는 session_id 기준 생성
- 상태: draft / finalized
- draft: 수정 가능
- finalized: 수정 불가. 재계산 시 새 version 생성 (overwrite 금지)
- receipt_snapshots: append-only
- participant별 지급액 별도 기록

## 16. 크로스 스토어 (CRITICAL LOCK)
- 아가씨는 타 가게 근무 가능
- 정산은 session.store_uuid 기준
- 이동 단위: business_day_id 기준
- 승인: transfer_request (출발 + 도착 모두 필요)
- transfer 상태: pending / approved / rejected / cancelled
- 이동 이력 append-only
- participant.store_uuid = 실제 근무 가게 (원소속 금지)

## 17. 오프라인 정책
- 저장소: IndexedDB (업무 데이터)
- localStorage: UI 상태만
- 저장 허용: 세션 / 주문 / draft 정산
- 저장 금지: final 정산 확정
- 충돌: 서버 우선 + conflict_pending

## 18. 마감 규칙
- owner/권한 관리자만 마감 가능
- 마감 후 수정 불가 (재오픈 요청만 가능)
- 미마감 상태 다음날 영업 가능 (경고만)
- 마감 기준: business_day_id

## 19. 보안 원칙 (CRITICAL)
- 모든 write에 actor(user_id) 기록
- audit_events append-only
- RLS store_uuid 기준 전체 적용
- 클라이언트 금액 입력 금지
- 정산 서버 전용 계산

## 20. 금지 사항 (HARD LOCK)
- store_code를 식별자로 사용 금지
- room_no로 조회 금지
- store_id (numeric) 사용 금지
- user_id로 권한 판단 금지
- calendar date 직접 집계 금지
- membership 없이 데이터 생성 금지
- session 없이 정산/주문 생성 금지
- 클라이언트 계산 금지
- settlement overwrite 금지 (versioning 필수)
- counter를 role enum에 넣기 금지
- 원소속 store_uuid를 participant에 사용 금지

## 21. 보안 추가 잠금 (CRITICAL)
- 모든 API는 membership_id / store_uuid / role / status 검증 후 실행
- 모든 업무 조회/수정은 store_uuid 스코프 강제
- pending / suspended / rejected 상태 write/read 전면 차단
- audit_events: append-only, UPDATE/DELETE 절대 금지
- 정산 계산은 서버 함수만 허용, 금액 클라이언트 입력 금지
- business_day closed 상태에서 세션/주문/정산/설정 수정 금지
- transfer_request는 출발/도착 양측 승인 전 확정 금지
- CSV/export는 role 범위 내 데이터만 허용
- soft delete 복구는 owner/관리자만 가능, audit 기록 필수
- BLE 이벤트는 정산 확정 트리거 불가, 보조 신호만
- 가격표/store_settings 수정은 owner/관리자만, 변경 이력 필수

## 22. store_uuid 예외 명확화
업무 테이블: store_uuid 필수
아래 테이블만 예외 허용:
- profiles (글로벌 사용자)
- auth 관련 테이블
- 시스템 설정
- audit_events (store_uuid 있지만 글로벌 조회 가능)
