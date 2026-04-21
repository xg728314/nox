[ROUND]
044

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
영수증 생성 API.
POST /api/sessions/receipt
정산 결과를 receipt_snapshots에 append-only 기록.

[TARGET FILES]
C:\work\nox\app\api\sessions\receipt\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\receipt\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id
- session_id로 room_sessions 조회. store_uuid 일치 확인.
- receipts 테이블에서 해당 session_id의 receipt 조회. 없으면 400 (정산 먼저 필요).
- session_participants 조회 (해당 session)
- orders 조회 (해당 session)
- snapshot JSON 구성:
  - receipt 데이터 (gross_total, tc_amount, manager_amount, hostess_amount, margin_amount 등)
  - participants 배열
  - orders 배열
  - created_at timestamp
- receipt_snapshots 테이블에 INSERT (append-only)
- room_uuid는 room_sessions에서 가져옴
- audit_events 기록 필수
- 응답: snapshot_id, session_id, room_uuid, store_uuid, created_at
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함

[FAIL IF]
- role 체크 없음
- receipt 존재 체크 없음
- snapshot에 필수 데이터 누락
- receipt_snapshots INSERT 누락
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
