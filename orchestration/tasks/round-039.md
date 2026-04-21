[ROUND]
039

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
주문 추가 API 생성.
POST /api/sessions/orders
session_id에 주문 추가. 서버에서 amount 계산.

[TARGET FILES]
C:\work\nox\app\api\sessions\orders\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\orders\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id, item_name, order_type, qty, unit_price
- session_id로 room_sessions 조회. status='active' 확인. 아니면 400.
- session.store_uuid와 authContext.store_uuid 일치 확인
- amount = qty * unit_price (서버 계산)
- orders 테이블에 INSERT (ordered_by = authContext.user_id)
- audit_events 기록 필수
- 응답: order_id (id), session_id, item_name, order_type, qty, unit_price, amount, ordered_by
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함
- NOX_PROJECT_TRUTH.md 원칙: 서버에서만 계산, 클라이언트 금액 입력 금지 (amount는 서버가 계산)

[FAIL IF]
- role 체크 없음
- session active 체크 없음
- amount를 클라이언트에서 받음
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
