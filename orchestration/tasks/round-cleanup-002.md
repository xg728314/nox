NOX 구조 정리 2차 라운드다.
이번 라운드는 권한 반영 지연과 진입 게이트 누락, 그리고 대형 파일 분해까지만 한다.

[고정 규칙]
- 기능 추가 금지
- 시각 디자인 변경 금지
- 비즈니스 룰 변경 금지
- 실제 파일 기준으로만 판단
- 지정 범위 밖 수정 금지

[작업 1: authCache TTL 축소 + invalidation 점검]
대상:
- lib/auth/authCache.ts
- 관련 auth/logout/role-change/must_change_password 경로

해야 할 일:
- 현재 TTL_MS 값 확인
- 60초 유지 이유가 코드에 있는지 확인
- TTL 을 보수적으로 단축
- 캐시 무효화 가능한 경로가 있으면 연결
- 없다면 어떤 이벤트에서 stale auth 가 생기는지 정확히 보고

[작업 2: DailyOpsCheckGate 적용 범위 확장]
대상 진입점 확인:
- /staff
- /counter
- /owner
- /manager
- /admin

해야 할 일:
- 현재 어디에만 게이트가 걸려 있는지 실제 코드로 확인
- /manager 와 /admin 에 동일 정책 적용
- 우회 진입이 가능한지 확인
- role 별로 의도된 예외가 있으면 보고

[작업 3: app/staff/page.tsx 분해]
대상:
- app/staff/page.tsx

해야 할 일:
- 파일 역할을 실제 섹션 기준으로 분리
- 추천 분리 단위:
  - StaffList
  - AttendanceToggle
  - WorkLogModal
  - VisibilityControl
- 단, 비즈니스 로직 변경 없이 컴포넌트 분리만
- props drilling 과 타입 붕괴가 생기지 않게
- dead code 생기면 같이 제거

[검증]
반드시 실행:
- npm run build
- npx tsc --noEmit

[출력 형식]
1. 현재 확인 사실
2. 수정 파일
3. TTL 변경 전/후
4. Gate 적용 전/후
5. staff/page 분해 결과
6. build / tsc 결과
7. 남은 리스크