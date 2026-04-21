[ROUND]
040

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
연장 API 생성.
POST /api/sessions/extend
session_participant의 time_minutes 추가. price_amount 재계산.

[TARGET FILES]
C:\work\nox\app\api\sessions\extend\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\extend\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id, participant_id, extend_minutes (15분 단위)
- session_id로 room_sessions 조회. status='active' 확인.
- participant_id로 session_participants 조회. status='active' 확인.
- session.store_uuid와 authContext.store_uuid 일치 확인
- session_participants UPDATE: time_minutes += extend_minutes
- audit_events 기록 필수 (before/after 포함)
- 응답: participant_id, session_id, time_minutes (updated), status
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함

[FAIL IF]
- role 체크 없음
- session/participant active 체크 없음
- store_uuid 스코프 무시
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
