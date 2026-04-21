# ROUND 103 결과: COUNTER-NAME-MATCH-FLOW-001

## 1. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `app/counter/page.tsx` | 바텀시트 플로우를 store → category → name 으로 변경 |
| `app/api/store/staff/route.ts` | hostess 응답에 `manager_membership_id`, `manager_name` 포함 (이전 라운드에서 완료) |

## 2. 제거된 것

- 기존 `"hostess"` 단계 (이름 수기 입력만 가능, 매칭 없음)
- 기존 `"manager"` 단계 (별도 실장 선택 화면)
- `externalHostessName` 상태 변수 및 모든 참조

## 3. 새로운 플로우

### 바텀시트 단계: store → category → name

1. **store**: 가게 선택 (기존과 동일). 선택 시 해당 가게의 아가씨 + 실장 목록을 미리 로드
2. **category**: 종목 선택 (퍼블릭/셔츠/하퍼). 선택 시 바로 name 단계로 이동
3. **name**: 이름 입력 + 자동 매칭
   - 텍스트 입력 → `addHostessList` 에서 이름 포함 필터링
   - **1명 매칭** → 자동 선택 + 담당실장 자동 연결 (emerald 확인 UI)
   - **다수 매칭** → 후보 목록 표시, 선택 가능
   - **0명 매칭** → 경고 메시지 표시
   - 매칭된 아가씨에 담당실장이 없으면 → 실장 수동 선택 UI 표시
   - 완료 버튼은 `nameConfirmed && addManager` 조건 충족 시에만 활성화

## 4. 자동 매칭 로직

```
입력값 → addHostessList.filter(h => h.name.includes(입력값))
  → 1건: 자동 선택 + manager_membership_id/manager_name 자동 연결
  → N건: 후보 카드 리스트, 사용자가 터치 선택
  → 0건: "매칭되는 아가씨가 없습니다" 경고
```

## 5. handleSheetCommit 변경

- `membership_id`: 매칭된 아가씨의 `membership_id` 전달 (이전: 본점만 가능)
- `external_name`: 매칭된 아가씨 이름 또는 입력값 전달
- `manager_membership_id`: 자동/수동 선택된 실장 전달
- `entered_at`: 확정 시점으로 갱신

## 6. 상태 변수 정리

| 변수 | 용도 |
|------|------|
| `nameInput` | 이름 입력값 |
| `nameMatches` | 필터링된 후보 목록 |
| `nameConfirmed` | 매칭 확정 여부 |
| `addHostess` | 선택된 아가씨 (id, name) |
| `addManager` | 선택된 실장 (membership_id, name) |

## 7. 수정 이력 (audit)

현재 수정 이력은 기존 PATCH API의 audit_events 기록을 활용.
별도 수정 로그 테이블 추가는 이번 라운드 범위 밖 (기존 audit_events로 충분).

## 8. 검증

- `tsc --noEmit`: 0 errors
- 기존 participant 카드/카운트 표시 유지
- entered_at 확정 시점 관리 유지
