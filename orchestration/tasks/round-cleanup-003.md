NOX 정리 3차 라운드다.
이번 라운드는 죽은 코드 제거와 silent failure 감사만 한다.

[고정 규칙]
- 기능 추가 금지
- 새 정책 도입 금지
- 추측 금지
- 반드시 실제 참조 여부를 grep/search 로 증명

[작업 1: dormant / vestigial 코드 제거 후보 검증]
후보:
- lib/events/notificationStore.ts
- lib/settlement/computeSessionShares.ts
- app/api/admin/members/invite/route.ts

해야 할 일:
- 각 파일의 실제 import / 호출 / 라우팅 사용 여부 확인
- 호출자 0이면 삭제안 제시
- 호출자 있으면 forwarder 유지 필요성 판단
- dead code 제거 시 영향 범위 같이 제시

[작업 2: console.warn / console.error 로 끝나는 실패 경로 감사]
해야 할 일:
- production 코드 전체 스캔
- 실패인데 운영자 액션 없이 로그만 남는 경로 분류
- 아래 두 종류로 나눠라
  1. 반드시 fail-close 해야 하는 것
  2. best-effort 로 남겨도 되는 것
- 특히 mutation / cron / payout / attendance 계열 우선

[검증]
- npm run build
- npx tsc --noEmit

[출력 형식]
1. dead code 확인 결과
2. 삭제 가능 파일 / 유지 필요 파일
3. silent fail 목록
4. fail-close 필요 목록
5. best-effort 유지 가능 목록
6. 수정 파일
7. build / tsc 결과
8. 다음 추천 작업