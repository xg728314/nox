[ROUND]
STEP-013A

[TASK TYPE]
locked security hardening task

[OBJECTIVE]
STEP-012까지 완료된 상태에서 정산 UI가 실사용 가능해졌지만,
현재는 권한 통제가 충분히 강제되지 않은 상태다.

이번 단계의 목표는:
1. 역할 기반 접근 제어 강화 (owner / manager / hostess)
2. 지급 / 교차정산 액션 권한 제한
3. UI 숨김이 아닌 서버 레벨 차단
4. 페이지 접근 + API 접근 모두 통제

이 단계는 "보안 강화"이며 기능 추가가 아니다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 핵심 로직 변경 금지
- UI 표시만으로 권한 처리 금지 (서버에서 차단 필수)
- store_uuid scope 규칙 유지
- resolveAuthContext 기반 권한 판단 유지

[ROLE DEFINITIONS]

owner:
- 모든 정산 접근 가능
- payout 실행 가능
- cross-store 생성 가능

manager:
- 자신이 담당한 아가씨만 접근 가능
- payout 제한적 허용 (정책에 따라 허용/차단)
- cross-store 생성 금지 (기본)

hostess:
- 자기 데이터만 조회 가능
- payout 불가
- cross-store 접근 불가

[REQUIRED CHANGES]

A. API LEVEL HARDENING (필수)

모든 아래 API에 대해 role 검증 추가:

1. POST /api/settlement/payout
- 허용: owner, manager
- hostess → 403

2. GET /api/settlements/managers
- 허용: owner
- manager → 자기 데이터만 제한적 허용 가능 (선택)
- hostess → 403

3. GET /api/settlements/hostesses
- owner: 전체
- manager: 자기 담당 아가씨만
- hostess: 자기 것만

4. POST /api/cross-store
- owner만 허용

5. POST /api/cross-store/payout
- owner만 허용

6. GET /api/cross-store*
- owner만 허용 (기본)
- 필요 시 manager read 허용은 명시적으로 제한

모든 API는:
- resolveAuthContext 후 role 확인
- store_uuid 스코프 확인
- mismatch 시 즉시 403

---

B. DATA FILTERING

manager:
- 반드시 manager_membership_id 기준으로 데이터 필터링
- 자기 담당 데이터만 조회

hostess:
- membership_id 기준으로 자기 데이터만 조회

---

C. UI LEVEL HARDENING

1. /payouts/managers
- owner만 접근 가능
- manager 접근 시 redirect 또는 403

2. /payouts/hostesses
- owner: 전체
- manager: 담당 아가씨만
- hostess: 자기 데이터만

3. /payouts/cross-store
- owner만 접근 가능

4. payout 버튼
- role 체크 후 표시
- hostess에서는 완전히 제거

---

D. ROUTE GUARD

가능하면:
- server component 또는 middleware에서 role guard 적용

예:
- owner-only 페이지
- manager-only 페이지

---

E. ERROR HANDLING

권한 없는 접근 시:
- 403 반환
- UI에서는 명확한 메시지 또는 redirect 처리

---

[VALIDATION REQUIREMENTS]

반드시 확인:

1. hostess가 payout API 호출 시 → 403
2. manager가 cross-store 생성 시 → 403
3. 다른 매장 데이터 접근 시 → 403
4. manager가 자기 담당 외 데이터 조회 불가
5. UI에서 숨겨도 API 호출하면 차단됨
6. role 기반 분기 정상 동작
7. tsc --noEmit 통과
8. 기존 기능 정상 유지

---

[FAIL IF]

- UI에서만 권한 숨김 처리
- API에서 권한 체크 없음
- manager가 전체 데이터 조회 가능
- hostess가 payout 가능
- cross-store를 manager가 실행 가능
- store_uuid 검증 누락
- 기존 payout/cross-store 로직 변경됨

---

[OUTPUT FORMAT]

1. FILES CHANGED
2. API HARDENING
3. UI HARDENING
4. ROLE LOGIC
5. VALIDATION
6. RISKS