# Round-073 작업 지시문
## Cross-store 기반 구축

## 사전 작업
1. app/api/sessions/settlement/route.ts 읽기
2. database/002_actual_schema.sql 읽기 (없으면 현재 스키마 파악)
3. state.json 확인

## 목표
타매장 출근 아가씨의 근무 기록 DB 저장 + 원소속 매장 귀속 정산 기반 구축

## 비즈니스 규칙
- 아가씨는 원소속 매장에 영원히 귀속
- 워킹 매장 = 장소 제공만, 수수료 없음
- 모든 정산은 origin_store_uuid 기준으로만 계산
- 기존 % 기반 정산 로직 삭제 대상

## PLANNER - 신규 테이블 3개

### 1. store_service_types (종목 설정 - 하드코딩 금지)
- store_uuid, name (퍼블릭/셔츠/하퍼)
- fulltime_min, fulltime_price
- halftime_min, halftime_price  
- cha3_min_start, cha3_min_end, cha3_price
- boundary_min (경계구간 분)
- is_active, effective_from, created_by

### 2. cross_store_work_records (타매장 근무 기록)
- session_id, working_store_uuid, origin_store_uuid
- hostess_membership_id, approved_by
- status (pending/approved/rejected)

### 3. inter_store_ledger (매장간 줄돈/받을돈)
- from_store_uuid, to_store_uuid
- amount, direction (give/receive)
- source_record_id
- status (draft/pending/adjusted/closed/paid)
- business_day

## EXECUTOR - 작업 순서
1. database/migrations/003_cross_store.sql 생성
2. app/api/cross-store/work-record/route.ts 생성
3. app/api/cross-store/approve/route.ts 생성
4. app/api/cross-store/records/route.ts 생성

## 절대 규칙
- 기존 테이블 (room_sessions, session_participants, receipts) 수정 금지
- store_uuid 보안 스코프 유지
- UI 계산 금지 - 서버에서만 계산
- 모든 API에 audit_events INSERT 포함
- 추측 금지, 실패시 즉시 reject + 사유 명시

## VALIDATOR - 완료 기준
- 003_cross_store.sql 마이그레이션 오류 없음
- POST work-record → DB 저장 확인
- POST approve → status 변경 확인
- GET records → store_uuid 필터 동작 확인
- audit_events 기록 확인
- tsc 0 errors
- 빌드 통과

## reject 조건
- 기존 테이블 수정 시 즉시 reject
- store_uuid 없이 데이터 조회 허용 시 즉시 reject
