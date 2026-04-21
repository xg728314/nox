[ROUND]
038

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
참가자 등록 API 생성.
POST /api/sessions/participants
session_id에 아가씨/실장 참가자 등록. membership_id 기준. category/time_minutes 포함.

[TARGET FILES]
C:\work\nox\app\api\sessions\participants\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\participants\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id, membership_id, role (manager/hostess), category (퍼블릭/셔츠/하퍼/차3), time_minutes
- session_id로 room_sessions 조회. status='active' 확인. 아니면 400.
- session.store_uuid와 authContext.store_uuid 일치 확인
- membership_id로 store_memberships 조회. 존재+approved 확인
- session_participants 테이블에 INSERT
- price_amount는 서버에서 계산하지 않음 (이 단계에서는 0)
- audit_events 기록 필수
- 응답: participant_id (id), session_id, membership_id, role, category, status, entered_at
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함
- NOX_PROJECT_TRUTH.md 원칙 준수: membership_id 기준, store_uuid 스코프

[FAIL IF]
- role 체크 없음
- session active 체크 없음
- store_uuid 스코프 무시
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
