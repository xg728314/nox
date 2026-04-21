[ROUND]
037

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
체크인 API 생성.
POST /api/sessions/checkin
room_uuid로 세션 생성. business_day_id 연결. active session 중복 방지.

[TARGET FILES]
C:\work\nox\app\api\sessions\checkin\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\sessions\checkin\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- resolveAuthContext 사용
- owner/manager만 허용. hostess는 403.
- room_uuid로 rooms 테이블에서 store_uuid 일치 확인
- 같은 room_uuid에 active session 있으면 409 반환
- business_day_id: 오늘 날짜 store_operating_days에서 조회
- 없으면 자동 생성
- room_sessions 테이블에 INSERT
- audit_events 기록 필수
- 응답: session_id, room_uuid, store_uuid, status, started_at

[FAIL IF]
- role 체크 없음
- 중복 세션 체크 없음
- business_day_id 없이 생성
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
