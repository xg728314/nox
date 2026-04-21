# COUNTER-FLOW-BUG-FIX-001 결과

## 1. 아가씨 목록이 뜨던 실제 렌더 경로

```
openSheetForEdit → setAddStep("store")
→ 가게 선택 클릭 → loadAddManagerList(store.name)
→ GET /api/store/staff?role=manager&store_name=XXX
→ store/staff route.ts의 storeNameParam 분기 (line 34)
→ role 파라미터 무시, hardcoded `.eq("role", "hostess")` (line 58)
→ 아가씨 목록이 addManagerList에 저장됨
→ addStep === "manager" UI가 아가씨 이름을 실장 선택지로 표시
```

**원인**: `store/staff` API의 `storeNameParam` 분기가 `roleParam`을 완전히 무시하고 `hostess` 역할만 조회하도록 하드코딩되어 있었음.

## 2. PATCH 400 실제 원인

```
사용자가 "실장" 목록에서 아가씨를 선택
→ addManager = { membership_id: <hostess_membership_id>, name: ... }
→ handleSheetCommit → PATCH body에 manager_membership_id = <hostess_membership_id>
→ participants PATCH route line 213: mgrMembership.role !== "manager" → 400
→ "해당 membership은 실장(manager) 역할이 아닙니다."
```

**원인**: BUG 1과 동일 근본 원인. 아가씨 membership_id가 manager_membership_id로 전달되어 role 검증 실패.

## 3. 수정 파일 목록

### `app/api/store/staff/route.ts`

| 수정 내용 | 이전 | 이후 |
|-----------|------|------|
| role 필터 | `.eq("role", "hostess")` 하드코딩 | `roleParam` 반영 (`manager` or `hostess`) |
| status 필터 | 없음 | `.eq("status", "approved")` 추가 |
| select 필드 | `id, store_uuid, profile_id` | `id, store_uuid, profile_id, role` 추가 |
| manager 분기 | 없음 | `managers` 테이블에서 이름 조회, 별도 응답 조립 |
| hostess 분기 | 기존 로직 유지 | 기존 로직 그대로 (조건부 진입) |

## 4. 수정 후 동작 확인

- `tsc --noEmit`: 0 errors
- 플로우: store 선택 → `?role=manager&store_name=XXX` → **실장 목록만** 반환
- manager 선택 → handleSheetCommit → PATCH body의 `manager_membership_id`가 실제 manager → role 검증 통과 → **200**
- 아가씨 목록 비노출 ✓
- 담당 실장 선택 가능 ✓
- PATCH 200 ✓
- participant 확정 정상 ✓
- settlement / checkout 수정 없음
