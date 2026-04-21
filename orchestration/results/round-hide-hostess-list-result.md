# ROUND: HIDE-HOSTESS-LIST-MANAGER-ONLY-001 결과

## 1. 제거한 UI/상태 목록

| 항목 | 유형 | 파일 |
|------|------|------|
| `addHostessList` | state (`useState<StaffItem[]>`) | `app/counter/page.tsx` |
| `setAddHostessList` | setter (4곳 참조 제거) | `app/counter/page.tsx` |
| `loadAddHostessList()` | async function (16행) | `app/counter/page.tsx` |
| `/api/store/staff?role=hostess` 호출 | API fetch | `app/counter/page.tsx` |

제거 후 counter 페이지에서 타가게 아가씨 목록을 fetch하는 코드가 0건.

## 2. 새 바텀시트 단계

```
store → category → manager → 완료 (participant 확정)
```

- `"store"`: 가게 선택 (15개). 선택 시 실장 목록만 로드 (`loadAddManagerList`)
- `"category"`: 종목 선택 (퍼블릭 90분 / 셔츠 60분 / 하퍼 60분)
- `"manager"`: 담당 실장 선택 → 완료 버튼 → `handleSheetCommit`

이름 입력 단계 없음. 이름은 participant 카드 인라인 input에서만 수기 입력.

## 3. 담당 실장 선택 방식

- 가게 선택 시 `loadAddManagerList(store.name)` 호출
- `/api/store/staff?role=manager&store_name=...` 로 실장만 조회
- 실장 목록 카드 UI 표시 (이름 + 아바타)
- 선택 필수 (미선택 시 완료 버튼 disabled)
- 완료 시 `manager_membership_id` 저장

## 4. 더 이상 노출되지 않는 데이터 목록

| 데이터 | 이전 상태 | 이후 상태 |
|--------|-----------|-----------|
| 타가게 아가씨 이름 목록 | `addHostessList`로 로드 → state 보관 | **로드 자체를 하지 않음** |
| 타가게 아가씨 출근 현황 | hostess API 응답에 포함 가능 | **API 호출 없음** |
| 아가씨 자동 매칭 후보 | `nameMatches` 필터링 → UI 노출 | **상태/UI 모두 이전 라운드에서 제거 완료** |
| 아가씨 담당실장 연결 정보 | hostess 응답의 `manager_membership_id` | **API 호출 없음** |
| `/api/store/staff?role=hostess` 응답 | counter에서 호출 | **counter에서 호출 0건** |

## 5. 검증

- `tsc --noEmit`: 0 errors
- `role=hostess` API 호출: counter 내 0건
- `addHostessList` / `loadAddHostessList` 참조: 0건
- 바텀시트 단계: `store` / `category` / `manager` 만 존재
- settlement / checkout 변경 없음
