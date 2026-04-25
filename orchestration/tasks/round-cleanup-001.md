NOX 코드베이스 정리 라운드다.
추측하지 말고 실제 파일 기준으로만 작업해라.

목표는 3개뿐이다.

1. orphan cron route 정리
2. migration 010 중복 해결
3. production 코드의 위험한 as any 제거 (핵심 경로 우선)

반드시 아래 규칙을 지켜라.

[고정 규칙]
- 새 기능 추가 금지
- UI 변경 금지
- 리팩터링 과확장 금지
- 지정한 범위 밖 수정 금지
- 추측 금지, 실제 참조/grep 결과로만 판단
- 마지막에 반드시 변경 파일 / 근거 / 검증 결과 보고

[작업 1: BLE session-inference orphan 여부 확정]
다음 파일을 실제 확인:
- app/api/cron/ble-session-inference/route.ts
- lib/server/queries/bleSessionInference.ts
- vercel.json

해야 할 일:
- 현재 vercel.json cron 등록 상태 확인
- ble-session-inference 가 실제 등록 누락인지 확인
- 누락이면 "살릴 때 필요한 최소 수정안"과 "삭제할 때 제거 범위" 둘 다 제시
- 단, 이 라운드에서는 임의 삭제하지 말고 기본안은 '등록 복구안' 기준으로 준비
- vercel Hobby/배포 제약이 코드/주석/문서에 있는지도 확인

[작업 2: migration 010 중복 해결]
다음 파일을 실제 스캔:
- database 디렉토리 전체
- database/000_migration_tracker.sql 포함

해야 할 일:
- 010 prefix 중복 파일 2개 확인
- 실제 적용 순서 의존성이 있는지 확인
- 가장 안전한 재번호 변경안을 제시하고 반영
- import/reference/문서/적용 스크립트 영향 있으면 같이 수정
- 결과적으로 migration ordering 이 deterministic 하게 되게 해라

[작업 3: 위험한 as any 제거]
우선 아래 경로부터 처리:
- app/api/manager/hostesses/[hostess_id]/route.ts
- app/api/me/sessions/[session_id]/route.ts
- app/api/me/settlement-status/route.ts
- app/api/store/settings/route.ts

규칙:
- 무조건 타입 좁히기 방식으로 해결
- 무턱대고 타입 단언 추가하지 마라
- Supabase join 응답 shape 실제 select 기준으로 안전 타입 정의
- store/settings 의 body 동적 접근은 화이트리스트 기반으로 바꿔라
- unknown → validator/type guard → typed object 순으로 처리
- any 제거하다가 기능 깨질 위험 있으면 그 지점은 보수적으로 타입 helper 추가

[검증]
반드시 실행:
- npm run build
- npx tsc --noEmit

가능하면 추가:
- grep 기준 as any 감소 수치
- 관련 route 동작에 필요한 최소 정적 검증

[출력 형식]
1. 확인한 사실
2. 수정한 파일 목록
3. exact diff summary
4. orphan route 결론
5. migration 재번호 결과
6. as any 제거 결과
7. build / tsc 결과
8. 남은 리스크

중요:
내가 요구한 3개 외 영역으로 리팩터링을 퍼뜨리지 마라.