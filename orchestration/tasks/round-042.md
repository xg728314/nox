[ROUND]
042

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
체크아웃 API 생성.
POST /api/sessions/checkout
세션 종료. 모든 active 참가자를 left 처리.

[TARGET FILES]
C:\work\nox\app\api\sessions\checkout\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\checkout\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id
- session_id로 room_sessions 조회. status='active' 확인. 아니면 400.
- session.store_uuid와 authContext.store_uuid 일치 확인
- room_sessions UPDATE: status='closed', ended_at=now(), closed_by=authContext.user_id
- session_participants에서 status='active'인 모든 참가자: status='left', left_at=now()
- audit_events 기록 필수 (session close + participant close)
- 응답: session_id, status ('closed'), ended_at, participants_closed_count
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함

[FAIL IF]
- role 체크 없음
- session active 체크 없음
- 참가자 일괄 left 처리 누락
- session status를 'closed'로 변경 안 함
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
