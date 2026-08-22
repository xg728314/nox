---
name: offline-safety
description: NOX 오프라인 (IndexedDB) 큐 작업 시 FORBIDDEN_OFFLINE_TYPES 준수 · server truth 우선 · draft 만 허용 규칙
---

# Offline Safety

카운터 PC 는 인터넷 잠깐 끊길 수 있음. IndexedDB 큐로 임시 저장 후 sync.
**단, 서버 권위 상태전이는 절대 오프라인 불가.**

## 금지 타입 (FORBIDDEN_OFFLINE_TYPES)

`lib/offline/forbidden.ts` (단일 원본 · db.ts + sync.ts 양쪽 import):

```typescript
export const FORBIDDEN_OFFLINE_TYPES = [
  "settlement",           // 정산 생성
  "receipt",              // 영수증 스냅샷
  "finalize",             // 정산 확정
  "payment",              // 결제 방식 확정
  "finalize-settlement",  // 정산 확정 (별칭)
  "close-day",            // 영업일 마감
]
```

## 허용 타입

- Draft session 저장
- Draft order 저장
- 임시 참여자 리스트

## 이중 방어 패턴

1. **클라이언트 `enqueueEvent`**: 금지 타입이면 **즉시 throw** (`ForbiddenOfflineTypeError`)
   - UI 는 저장 성공으로 오인하지 않음
2. **서버 `syncEventQueue`**: 동일 리스트로 skip
   - 클라이언트 우회해서 큐에 넣어도 서버가 무시

**이유**: 한쪽만 하면 UI 는 "저장됨" 표시했는데 서버는 무시 → 실제로 저장 안 됨 → 정산 사고.

## Conflict resolution

- **Server truth wins** — sync 시 서버에 최신 데이터 있으면 클라이언트 큐 무시
- version conflict 발생 시 UI 에 알림 → 사용자 재확인 요구

## 코드 위치

- `lib/offline/db.ts` — IndexedDB wrapper (enqueueEvent, dequeueEvent 등)
- `lib/offline/sync.ts` — 온라인 복귀 시 큐 flush
- `lib/offline/forbidden.ts` — 금지 타입 단일 원본 (수정 시 이중 방어 유지)

## 자주 하는 실수

- ❌ 새 mutation 만들면서 offline 큐 지원 추가 → 금지 타입인지 확인 안 함
- ❌ 정산 finalize 를 offline 지원하려고 함 → 정산 무결성 위반
- ❌ forbidden.ts 수정 시 한쪽만 update → 드리프트 발생

## 신규 offline-safe mutation 추가 절차

1. 이 액션이 서버 권위 상태전이인가? (돈 · 확정 · 마감 관련)
2. 그렇다면 FORBIDDEN 리스트에 추가 · 오프라인 지원 포기
3. 아니라면 `enqueueEvent` 로 큐잉 · sync 시 conflict 처리 로직 추가

## 체크리스트

- [ ] 이 액션이 FORBIDDEN 리스트에 있는지 확인
- [ ] 새 mutation 이 정산/영수증/결제/마감 관련이면 FORBIDDEN 추가
- [ ] `forbidden.ts` 는 db.ts / sync.ts 양쪽에서 import
- [ ] Conflict 발생 시 UI 알림 흐름 준비
