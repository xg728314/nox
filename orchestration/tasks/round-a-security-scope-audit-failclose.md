[ROUND-A]
TASK TYPE: 보안 하드닝 1차
OBJECTIVE:
NOX 코드베이스에서 store_uuid 누락으로 인한 교차 매장 데이터 노출 가능성과 audit fail-open 구조를 동시에 제거한다.
이번 라운드는 “기능 추가” 금지. 보안 하드닝만 수행한다.

핵심 목표 2개:
1) 모든 API route / server-side mutation / 보조 lookup 에서 store scope 누락 제거
2) audit 로그 실패 시 mutation 이 성공하지 못하도록 fail-close 로 전환

절대 규칙:
- 추측 금지
- 실제 코드 기준으로만 수정
- DB schema 임의 변경 금지
- 기존 비즈니스 규칙 변경 금지
- UI 수정 금지
- 새 기능 추가 금지
- 기존 응답 shape 는 가능하면 유지
- store_uuid scope 와 audit 정책만 수정

중요 배경:
- 현재 구조는 RLS disabled 이므로 route layer 가 유일한 방벽이다.
- 보조 lookup 에서도 .eq("store_uuid", authContext.store_uuid) 누락되면 타 매장 데이터가 노출될 수 있다.
- 현재 다수 mutating route 에서 audit 가 try/catch 무시(best-effort) 구조라, audit 실패해도 돈/상태 변경이 진행된다.
- 이것은 locked rule 위반이다.

작업 범위:
1) app/api/**/route.ts
2) lib/** server-side helper 중 route 에서 호출되는 DB query helper
3) audit 관련 helper
4) 필요한 경우 공통 유틸 추가 가능 (단, 최소 범위)

반드시 수행할 것:

A. store scope 전수 감사 및 수정
- 모든 route 에서 DB read/write query 확인
- 다음 케이스를 특히 집중 점검:
  - primary entity 는 scoped 인데, 보조 lookup(room/manager/profile/store/member/hostess name lookup)이 unscoped 인 경우
  - soft delete 테이블인데 deleted_at 필터 누락
  - id 단건 조회만 믿고 store_uuid 필터 없는 경우
  - join 전후 중 한 단계라도 store_uuid 누락된 경우
- 수정 원칙:
  - authContext.store_uuid 사용
  - 모든 select/update/delete 에 store_uuid 조건 추가
  - 보조 lookup 도 동일 적용
  - deleted_at 있는 테이블은 필요한 경우 is null 조건도 보강
- 단, 실제 schema 에 deleted_at 없는 테이블에는 절대 넣지 말 것

B. audit fail-open 제거
- 현재 패턴:
  try { await logAuditEvent(...) } catch {}
  또는 void logAuditEvent(...).catch(...)
  또는 console.warn 만 남기고 mutation 진행
- 이를 fail-close 로 바꿔라.
- 원칙:
  - mutation 성공 전 audit 가 반드시 성공해야 함
  - audit 실패 시 명시적 에러 반환
  - 조용한 삼키기 금지
- 필요하면 공통 helper 작성:
  - 예: await logAuditEventOrThrow(...)
- 기존 route 마다 중복 코드가 심하면 helper 로 정리해도 됨

C. 수정 후 검증
- 최소한 다음을 확인:
  1) tsc --noEmit
  2) npm run build
  3) 변경 파일 목록
  4) route 별 scope 누락 수정 요약
  5) audit fail-open 제거 지점 목록

산출 형식:
반드시 아래 형식으로만 답변

1. FILES CHANGED
- 파일별 한 줄 설명

2. STORE SCOPE FIX SUMMARY
- 어떤 route / helper 에서 어떤 unscoped query 를 어떻게 막았는지
- “보조 lookup” 포함 여부 명시

3. AUDIT FAIL-CLOSE SUMMARY
- 어떤 패턴을 어떤 helper 또는 코드로 교체했는지
- 이제 어떤 경우 mutation 이 실패하는지 설명

4. VALIDATION
- tsc 결과
- build 결과

5. RISKS / FOLLOW-UP
- 이번 라운드에서 남은 위험
- 다음 라운드 추천 3개 이내

FAIL IF:
- store_uuid 누락 query 하나라도 남겼는데 확인 없이 종료
- audit 실패를 계속 catch 무시
- schema 추측해서 없는 deleted_at 조건 추가
- 기능 추가/UI 수정/비즈니스 규칙 변경
- 결과 보고서에 실제 수정 지점이 불명확

우선순위:
1) credits, settlements, staff-work-logs, counter monitor, cross-store 관련 route
2) 그 다음 모든 mutating route
3) 그 다음 read route 의 보조 lookup

출력은 코드 수정 완료 보고서만 제출.