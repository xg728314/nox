[ROUND]
STEP-015

[TASK TYPE]
locked operations UX task

[OBJECTIVE]
현재 NOX는 정산/지급/교차정산/보안 구조까지 대부분 완료되었지만,
운영자가 실제로 쓰기 편한 UX는 아직 거칠다.

이번 단계의 목표는:
1. raw UUID 입력 제거
2. picker 기반 입력으로 전환
3. payouts 진입 동선 개선
4. 검색 / 필터 / 정렬 보강
5. 실사용 흐름 최적화

이 단계는 계산/정산 엔진 변경이 아니라
운영 UX와 입력 안정성 개선 단계다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 핵심 로직 변경 금지
- canonical routes만 사용
- legacy route 재도입 금지
- UI 계산 금지
- store_uuid scope 규칙 유지
- 권한/보안 구조 약화 금지

[CURRENT UX PROBLEMS]
1. cross-store 생성 시 to_store_uuid raw 입력
2. manager_membership_id raw 입력
3. /payouts 진입 동선 부족
4. 실무용 검색/필터 부족
5. 상태/금액 파악은 가능하지만 조작 UX가 거칠다

[REQUIRED CHANGES]

A. PICKER / SELECTOR 추가

1. store picker
- cross-store 생성 시 to_store_uuid 직접 입력 금지
- selectable list 형태로 교체
- 표시값: store name / 식별 가능한 보조 정보
- 실제 전송값만 uuid

2. manager picker
- cross-store item 생성 시 manager_membership_id 직접 입력 금지
- 선택형 UI로 교체
- 해당 store 또는 정책상 허용된 범위만 표시

3. 필요 시 hostess picker
- 검색/필터 UX 보강용
- 직접 uuid 입력 금지

주의:
- picker 데이터도 canonical API 또는 신규 read API로 가져와야 함
- mock/hardcode 금지

---

B. READ API 보강 (필요 시)

이번 단계에서 아래 API를 추가할 수 있다.
단, 신규 canonical schema 기준이어야 한다.

예시:
- GET /api/stores
- GET /api/store-managers?store_uuid=...
- GET /api/payouts/navigation-summary
- GET /api/cross-store/options

필수 원칙:
- role/store scope 적용
- owner/manager/hostess 노출 범위 준수
- deleted_at 제외

---

C. PAYOUTS NAVIGATION 개선

다음 중 현재 프로젝트 구조에 맞는 방식으로 구현:

1. app-wide bottom nav / side nav에 payouts entry 추가
2. owner dashboard / manager dashboard에 payouts quick link 추가
3. settlement 관련 기존 진입점과 연결

목표:
- direct URL 없이도 진입 가능해야 함

---

D. FILTER / SEARCH / SORT 개선

최소 포함 권장:

1. /payouts/managers
- manager name 검색
- 상태 필터 (미지급 / 부분 / 완료)
- remaining 내림차순 기본 정렬 유지

2. /payouts/hostesses
- 이름 검색
- 상태 필터
- manager 기준 필터 (owner만)

3. /payouts/cross-store
- 상태 필터 (open / partial / completed)
- store 기준 검색
- 최근순 정렬

주의:
- 필터는 가벼운 범위 우선
- 실사용 중심
- 과도한 UI 장식 금지

---

E. FORM UX 개선

1. validation message 명확화
- 잘못된 입력 시 왜 안 되는지 표시
- 서버 에러 메시지도 적절히 노출

2. 중복 제출 방지 유지
- submit 중 버튼 disable
- 성공 시 refetch

3. amount 입력 UX
- 숫자 입력 안정화
- 천단위 표시 가능하면 보조 표시
- 실제 전송은 숫자 그대로

4. reason / memo 입력
- 길이 제한 UI 반영
- 필수값 명확화

---

F. STATUS VISIBILITY 개선

상태 badge 일관화:
- confirmed
- partial
- paid
- open
- completed
- cancelled (STEP-014 반영 시)

금액 정보는:
- total
- paid
- remaining
구분을 더 명확하게 보여줄 것

---

G. EMPTY / ERROR / LOADING UX 개선

반드시:
- 빈 상태에서 다음 행동 안내
- 에러 시 재시도 버튼
- 로딩 스켈레톤 또는 명확한 loading message
- 권한 부족 시 안내 또는 적절한 redirect

---

H. DO NOTS

- 계산식을 UI에서 새로 만들지 말 것
- UUID 직접 입력을 남겨두지 말 것
- 보안된 owner-only 액션을 picker 편의 때문에 완화하지 말 것
- 임시 mock 데이터 넣지 말 것

[VALIDATION REQUIREMENTS]

반드시 확인:
1. cross-store 생성에서 raw uuid 직접 입력 제거
2. manager 선택도 raw uuid 제거
3. payouts 진입 링크 추가
4. 검색/필터 동작
5. canonical API만 사용
6. 권한 구조 유지
7. tsc --noEmit 통과
8. 가능하면 build 통과
9. 기존 payout/create/security flow 정상 유지

[FAIL IF]
- raw uuid 입력 여전함
- legacy API 사용
- mock 데이터 사용
- UI에 계산 로직 추가
- 진입 동선 개선 없음
- 보안 약화
- 기존 payout/cross-store 동작 깨짐

[OUTPUT FORMAT]
1. FILES CHANGED
2. UX IMPROVEMENTS
3. API ADDED / USED
4. NAVIGATION / FILTERS
5. VALIDATION
6. RISKS / FOLLOW-UPS