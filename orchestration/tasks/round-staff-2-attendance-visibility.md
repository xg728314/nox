[ROUND-STAFF-2]
TASK TYPE: staff 출근 공유 옵션 2차 구현

OBJECTIVE:
같은 매장 내에서 출근 현황을
1) 내 아가씨만 볼지
2) 같은 매장 전체를 볼지
사용자별로 선택 가능하게 만든다.

이번 라운드는 “공유 옵션 + 조회 반영”까지만 한다.
BLE / cron / 자동 출근 / migration 은 절대 금지.

핵심 목표:
- manager 는 기본적으로 자기 담당 아가씨만 본다
- 하지만 사용자가 공유 옵션을 켜면 같은 매장 전체 출근 현황을 볼 수 있다
- owner / super_admin 은 기존처럼 전체 유지
- 설정은 사용자별 저장
- 조회 API 가 이 설정을 실제로 반영해야 한다

절대 규칙:
- 추측 금지
- 실제 코드 기준
- schema 변경 금지
- migration 금지
- BLE / cron 금지
- 출근 ON/OFF 기존 동작 변경 금지
- 비즈니스 로직 임의 변경 금지
- UI 는 공유 옵션 관련 최소 범위만 수정
- store_uuid scope 절대 훼손 금지

작업 범위:

1. 사용자 설정 저장 경로 마련
- 기존 user_preferences 구조를 재사용
- scope 예시: "attendance_visibility"
- layout_config 예시:
  { "mode": "mine_only" } 또는 { "mode": "store_shared" }

2. user preference API 확인
- 이미 user-level preferences GET/PUT route 가 있으면 재사용
- 없으면 최소 신규 route 추가
- 본인 user_id 기준만 읽고 쓰기
- store_uuid 범위 유지

3. /api/attendance GET 확장
- owner / super_admin → 전체 유지
- manager:
  - 기본: mine_only → 자기 담당 아가씨만
  - store_shared → 같은 매장 전체 출근 현황
- 단, store_uuid 는 항상 auth.store_uuid 고정
- 다른 매장 데이터 절대 금지

4. /staff 페이지 UI
- 상단에 공유 옵션 토글 추가:
  - "내 아가씨만"
  - "같은 매장 전체"
- 초기 로드 시 현재 preference 읽기
- 변경 시 저장
- 저장 후 attendance / staff 목록 재조회

중요 정책:
- 이번 라운드의 “공유”는 출근 조회(shared visibility)만 의미한다
- 출근 ON/OFF 권한은 그대로 유지
- manager 가 다른 실장 담당 아가씨를 “볼 수는 있어도”
  출근 ON/OFF 는 여전히 자기 담당만 가능해야 한다
- 즉:
  조회 범위 ≠ 조작 권한

반드시 검증할 것:
1. manager + mine_only
   → 자기 담당 아가씨만 조회
2. manager + store_shared
   → 같은 매장 전체 조회
3. manager + store_shared 상태에서도
   자기 담당 아닌 아가씨 ON/OFF 시도 → 403 유지
4. owner
   → 항상 전체
5. 다른 매장 데이터
   → 절대 안 나옴
6. preference 저장 후 새로고침
   → 유지됨

권장 구현:
- attendance visibility mode 와 staff list visibility 를 같은 preference 로 통일 가능
- 단, 기존 manager self-filter 정책과 충돌 나지 않게
  "조회 전용 확장" 인지 명확히 하라
- `/api/store/staff` 와 `/api/attendance` 둘 다 동일한 visibility 판단을 쓰는 공통 helper 로 빼도 됨

산출 형식:
1. FILES CHANGED
2. PREFERENCE STORAGE
3. VISIBILITY RULES
4. UI FLOW
5. VALIDATION
6. RISKS / FOLLOW-UP

FAIL IF:
- BLE/cron 작업 포함
- migration/schema 변경
- manager 가 다른 실장 담당 아가씨를 조작 가능해짐
- store_uuid scope 훼손
- preference 저장은 되는데 조회에 반영 안 됨
- /staff 와 /api/attendance 가 서로 다른 visibility 규칙을 사용

출력은 수정 완료 보고서만 제출.