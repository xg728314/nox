# NOX_MANAGER_HOSTESS_VISIBILITY_RULES (LOCKED)

## 1. Purpose

manager가 볼 수 있는 hostess 범위를 정의한다.
이 문서는 NOX_ROLE_ACCESS_AND_SHELL_VISIBILITY_RULES의 하위 계약이다.
상위 문서와 충돌 시 상위 문서가 우선한다.

---

## 2. Scope

이 문서가 정의하는 범위:
- manager → hostess 방향의 읽기 가능 범위
- owner → hostess 방향의 읽기 가능 범위
- 같은 store 내 비배정 hostess의 기본 노출 여부

이 문서가 정의하지 않는 범위:
- hostess → manager 방향의 가시성
- settlement 계산 로직
- session 참여/배정 로직
- BLE 연동

---

## 3. Role visibility rules

### 3.1 manager → hostess

| 대상 | 가시성 |
|------|--------|
| 본인에게 배정된 hostess | 보임 |
| 같은 store 내 비배정 hostess | 숨김 |
| 다른 store의 hostess | 차단 (store_uuid scope) |

- manager는 본인에게 배정된(assigned) hostess만 조회할 수 있다.
- 배정 관계는 store_memberships 또는 배정 기록 기준으로 판단한다.
- 비배정 hostess는 존재 자체가 노출되지 않는다.

### 3.2 owner → hostess

| 대상 | 가시성 |
|------|--------|
| 같은 store 내 모든 hostess | 보임 |
| 다른 store의 hostess | 차단 (store_uuid scope) |

- owner는 같은 store_uuid에 속한 모든 hostess를 조회할 수 있다.
- 배정 여부와 무관하게 전체 목록을 볼 수 있다.

### 3.3 hostess → hostess

| 대상 | 가시성 |
|------|--------|
| 본인 정보 | 보임 |
| 다른 hostess | 숨김 |

- hostess는 본인 정보만 조회 가능하다.
- 다른 hostess의 존재는 노출되지 않는다.

---

## 4. Default visibility policy

- manager의 hostess 가시성은 **배정 범위 한정(assigned only)**이 기본값이다.
- 비배정 hostess는 기본적으로 숨김 처리된다.
- 이 기본값은 store 단위로 변경할 수 없다.
- UI 숨김과 API 차단이 동시에 적용된다.

---

## 5. Owner override policy

- owner는 store_uuid 범위 내 모든 hostess를 조회할 수 있다.
- 이것은 override가 아니라 owner role의 기본 권한이다.
- owner의 hostess 가시성에 배정 조건은 적용되지 않는다.

---

## 6. Future shared visibility policy

- 같은 store 내 manager 간 hostess 공유 가시성은 현재 비활성 상태이다.
- 공유 가시성은 기본값이 disabled이다.
- 활성화 시점은 별도 라운드에서 정의한다.
- 활성화되더라도 store_uuid scope는 유지된다.
- 활성화되더라도 다른 store의 hostess는 절대 노출되지 않는다.

---

## 7. Forbidden patterns

| # | 금지 패턴 | 이유 |
|---|---------|------|
| 1 | manager가 비배정 hostess를 조회 | 기본 가시성은 assigned only |
| 2 | manager가 다른 manager의 배정 hostess를 조회 | 공유 가시성은 기본 disabled |
| 3 | hostess가 다른 hostess를 조회 | 본인 정보만 허용 |
| 4 | UI에서 숨기고 API는 열어둠 | 숨김 = UI + API 동시 차단 |
| 5 | 클라이언트 입력으로 가시성 범위 확장 | 가시성은 서버 측 authContext + 배정 관계로만 결정 |
| 6 | store_uuid 없이 hostess 목록 조회 | 모든 조회는 store_uuid scope 필수 |

---

## 8. Locked summary

| 항목 | 기준 |
|------|------|
| manager → assigned hostess | 보임 |
| manager → non-assigned hostess | 숨김 |
| owner → same store all hostess | 보임 |
| hostess → self | 보임 |
| hostess → other hostess | 숨김 |
| cross-store hostess | 차단 |
| shared visibility default | disabled |
| UI hidden = API blocked | 필수 |
| visibility 결정 기준 | authContext.role + 배정 관계 + store_uuid |
