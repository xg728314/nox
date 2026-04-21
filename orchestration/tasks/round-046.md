[ROUND]
046

[TASK TYPE]
multi-file controlled change

[OBJECTIVE]
크로스 스토어 이동(Transfer) API 4개 구현.
- POST /api/transfer/request - 이동 신청
- POST /api/transfer/approve - 승인 (출발/도착 양측)
- POST /api/transfer/cancel - 취소
- GET /api/transfer/list - 목록 조회

[TARGET FILES]
C:\work\nox\app\api\transfer\request\route.ts
C:\work\nox\app\api\transfer\approve\route.ts
C:\work\nox\app\api\transfer\cancel\route.ts
C:\work\nox\app\api\transfer\list\route.ts

[ALLOWED_FILES]
C:\work\nox\app\api\transfer\request\route.ts
C:\work\nox\app\api\transfer\approve\route.ts
C:\work\nox\app\api\transfer\cancel\route.ts
C:\work\nox\app\api\transfer\list\route.ts

[FORBIDDEN_FILES]
C:\work\nox\orchestration\config\state.json
C:\work\nox\package.json
C:\work\nox\lib\auth\resolveAuthContext.ts

[CONSTRAINTS]
- transfer_requests 테이블 사용
- 컬럼: id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, reason, created_at, updated_at
- 출발 store + 도착 store 양측 승인 필요
- 양측 모두 승인 완료 시 status='approved' + hostess membership is_primary 변경
- audit_events 기록 필수
- resolveAuthContext 사용, owner/manager만 허용
- NOX_PROJECT_TRUTH.md 원칙 준수

[FAIL IF]
- role 체크 없음
- store_uuid scope 검증 누락
- 양측 승인 로직 누락
- audit_events 누락
- forbidden 파일 수정

[OUTPUT FORMAT]
FILES CHANGED:
EXACT DIFF:
VALIDATION:
