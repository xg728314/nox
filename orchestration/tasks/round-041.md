[ROUND]
041

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
중간 아웃 API 생성.
POST /api/sessions/mid-out
참가자를 세션에서 중도 퇴장 처리.

[TARGET FILES]
C:\work\nox\app\api\sessions\mid-out\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\mid-out\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- 요청 body: session_id, participant_id
- session_id로 room_sessions 조회. status='active' 확인.
- participant_id로 session_participants 조회. status='active' 확인.
- session.store_uuid와 authContext.store_uuid 일치 확인
- session_participants UPDATE: status='left', left_at=now()
- audit_events 기록 필수 (before/after 포함)
- 응답: participant_id, session_id, status ('left'), left_at
- 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 포함

[FAIL IF]
- role 체크 없음
- session/participant active 체크 없음
- status를 'left'로 변경 안 함
- left_at 미기록
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
