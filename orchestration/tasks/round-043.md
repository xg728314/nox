[ROUND]
043

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
정산 계산 API 생성.
POST /api/sessions/settlement
서버에서 정산 금액 계산. store_settings 기반.

[TARGET FILES]
C:\work\nox\app\api\sessions\settlement\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\settlement\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id
- session_id로 room_sessions 조회. status='closed' 확인 (체크아웃 후만 정산 가능).
- session.store_uuid와 authContext.store_uuid 일치 확인
- 기존 receipts에 해당 session_id가 있으면 409 (중복 정산 방지)
- store_settings 조회 (tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit)
- session_participants에서 참가자 금액 합산: participant_total = SUM(price_amount)
- orders에서 주문 금액 합산: order_total = SUM(amount)
- 정산 공식 (NOX_PROJECT_TRUTH.md 13번):
  gross_total = participant_total + order_total
  tc_amount = roundToUnit(gross_total * tc_rate, rounding_unit)
  base_amount = gross_total (payout_basis='gross') 또는 gross_total - tc_amount (payout_basis='netOfTC')
  manager_amount = roundToUnit(base_amount * manager_payout_rate, rounding_unit)
  hostess_amount = roundToUnit(base_amount * hostess_payout_rate, rounding_unit)
  margin_amount = gross_total - tc_amount - manager_amount - hostess_amount
- roundToUnit 함수: Math.round(value / unit) * unit
- receipts 테이블에 INSERT (status='draft')
- audit_events 기록 필수
- 응답: receipt_id, session_id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함
- 클라이언트 금액 입력 절대 금지. 서버에서만 계산.

[FAIL IF]
- role 체크 없음
- session closed 체크 없음
- 중복 정산 체크 없음
- 정산 공식 오류
- 클라이언트 금액 사용
- store_settings 미조회
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
