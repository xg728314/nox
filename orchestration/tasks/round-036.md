[ROUND]
036

[TASK TYPE]
multi-file api fix

[OBJECTIVE]
기존 14개 API route.ts 파일을 새 DB 스키마 기준으로 수정한다.

[TARGET FILES]
C:\work\nox\app\api\rooms\route.ts
C:\work\nox\app\api\rooms\[room_uuid]\route.ts
C:\work\nox\app\api\rooms\[room_uuid]\participants\route.ts
C:\work\nox\app\api\store\profile\route.ts
C:\work\nox\app\api\store\settlement\overview\route.ts
C:\work\nox\app\api\manager\dashboard\route.ts
C:\work\nox\app\api\manager\hostesses\route.ts
C:\work\nox\app\api\manager\hostesses\[hostess_id]\route.ts
C:\work\nox\app\api\manager\settlement\summary\route.ts
C:\work\nox\app\api\me\dashboard\route.ts
C:\work\nox\app\api\me\sessions\route.ts
C:\work\nox\app\api\me\sessions\[session_id]\route.ts
C:\work\nox\app\api\me\settlement-status\route.ts

[ALLOWED_FILES]
위 13개 파일만

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
수정 기준:
1. sessions 테이블 → room_sessions
2. session_status 컬럼 → status
3. manager_hostess_assignments 테이블 → hostesses (manager_membership_id 기준)
4. rooms.room_uuid → rooms.id
5. rooms.status → rooms.is_active
6. participant_type → role
7. participant_status → status
8. joined_at → entered_at
9. settlements 테이블 → receipts
10. users 테이블 → profiles (display_name → full_name)
11. membership 조회 시 authContext.user_id → authContext.membership_id
12. 모든 에러 핸들러에 MEMBERSHIP_NOT_APPROVED 추가
13. store/profile: store PK는 id

[FAIL IF]
- 수정 기준 누락
- 기존 auth 패턴 깨짐
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
- 수정된 파일 목록

EXACT DIFF:
- 파일별 변경 내용

VALIDATION:
- 각 수정 기준 항목 PASS/FAIL
