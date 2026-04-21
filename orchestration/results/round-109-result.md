# ROUND 109 결과: COUNTER-REFACTOR-PARTICIPANT-LIST-001

## 1. 새 파일

### `app/counter/ParticipantList.tsx`
- 종목별 카운트 영역 + 아가씨 카드 리스트 영역을 하나의 컴포넌트로 분리
- 내부에서 `ParticipantRow` import하여 map 렌더링
- 로직 변경 없음 — 기존 JSX 그대로 이동

## 2. page.tsx 에서 줄어든 영역

### 삭제된 블록 (약 28줄 → 15줄)
- 종목별 카운트 IIFE (`hostesses.reduce` → `catCounts` → `cats.map`)
- 아가씨 카드 리스트 (`focusData.loading` 분기 + `hostesses.map(h => <ParticipantRow>)`)
- `<ParticipantList>` 단일 태그로 대체

### 추가된 import
```typescript
import ParticipantList from "./ParticipantList"
```

## 3. 전달 props 목록

| Prop | Type | 출처 |
|------|------|------|
| `hostesses` | `Participant[]` | 필터링된 참여자 목록 |
| `selectedHostess` | `Set<string>` | 선택 상태 |
| `loading` | `boolean` | `focusData.loading` |
| `currentStoreUuid` | `string \| null` | 현재 매장 UUID |
| `stores` | `StoreOption[]` | 매장 옵션 목록 |
| `basis` | `"room" \| "individual"` | 시간 표시 기준 |
| `now` | `number` | 현재 시각 (ms) |
| `participants` | `Participant[]` | `focusData.participants` |
| `sessionStartedAt` | `string` | `focusData.started_at` |
| `onToggle` | `(id: string) => void` | `toggleHostess` |
| `onOpenEdit` | `(id: string) => void` | `openSheetForEdit` |
| `onNameBlur` | `(id, cur, next) => Promise<void>` | `handleExternalNameBlur` |
| `onMidOut` | `(id: string) => void` | `handleMidOut` |

## 4. 로직 변경 여부

**없음** — 기존 JSX/로직을 그대로 이동. 계산식, 상태, hooks, API 호출 모두 변경 없음.

## 5. 검증

- `tsc --noEmit`: 0 errors
- hooks 분리 없음
- API 호출 로직 이동 없음
- checkout/settlement 로직 수정 없음
- participant 데이터 구조 변경 없음
