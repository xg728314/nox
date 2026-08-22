---
name: chat-auto-registration
description: NOX 채팅 파싱 → 자동 세션 등록 파이프라인 전체. auto-fire · provisioning · pattern-dispatch · auto-confirm · auto-attendance. 관련 코드 수정 시 참조.
---

# Chat Auto-Registration Pipeline

실장이 채팅으로 "1번방 지연 셔 완메" 입력 → 자동으로 아가씨 등록 · 세션 참여자 생성 · 출근 체크까지 완료.

## 전체 흐름

```
채팅 메시지 (POST /api/chat/messages)
  ↓
ChatPatternAction (client · use client)
  - parseStaffChat(content) → entries[]
  - resolvedEntries: entries × building/hostesses × building/stores 매칭
  - auto-fire (1.5s 후, localStorage 마킹, silent 모드)
  ↓
createPending() (silent=true):
  1. 미매칭 → POST /api/hostesses/provisional (신규 생성)
  2. POST /api/chat/pattern-dispatch (chat_message_id + entries)
  ↓
Server: pattern-dispatch/route.ts:
  - INSERT chat_pattern_dispatches (status=pending)
  - owner/super_admin/(manager+본매장) → auto-confirm loop
  ↓
Server: pattern-dispatch/[id]/confirm/route.ts:
  - business_day 생성/보장
  - session 생성/재사용 (room 활성 시 참여자 추가)
  - transfer_request (cross-store)
  - session_participants INSERT
  - staff_attendance INSERT (status=in_room, 자동 출근) ← R-auto-checkin
  - dispatch status=approved
```

## 함정 · 실 이슈 대응

### 1. `profiles` 스키마 (provisional 관련)

```
CREATE TABLE profiles (
  id UUID NOT NULL PRIMARY KEY,  -- NO DEFAULT
  full_name TEXT,
  phone TEXT, nickname TEXT,
  is_active BOOLEAN,
  timestamps, deleted_at
);
```

- ❌ `role`, `email` 컬럼 **없음** — insert 시 unknown column 에러
- ❌ `id` DEFAULT 없음 — 누락 시 NOT NULL 위반
- ✅ `id: crypto.randomUUID()` 명시 필수

### 2. PGRST204 vs 42703

- `42703` = Postgres column does not exist (raw error)
- `PGRST204` = PostgREST schema cache miss (같은 원인 · 다른 코드)
- **둘 다 fallback 조건에 포함해야** column-missing 에러 catch 됨

### 3. Owner 경로 deleted_at 필터

`lib/server/queries/manager/hostesses.ts` line 90 근처:
```typescript
if (auth.role === "owner") {
  supabase.from("store_memberships")
    .select("id").eq(...)
    .is("deleted_at", null)  // ← 반드시 필터
}
```

### 4. pattern-dispatch 서버 검증

`app/api/chat/pattern-dispatch/route.ts`:
```
const CAT_SET = new Set(["퍼블릭", "셔츠", "하퍼"])
const TIME_SET = new Set(["기본", "반티", "차3", "반차3"])  // 반차3 포함
```

### 5. auto-fire 재실행 방지

`localStorage[nox_autofire_${chat_message_id}] = "1"` 마킹.
페이지 재진입 시 재발화 X · 중복 등록 방지.

### 6. Silent 옵션

`createPending({ silent: true })` — auto-fire 시 toast 안 뜸.
사용자 수동 클릭은 toast 표시.

### 7. from-parsed-chat 은 다른 경로

`/api/sessions/from-parsed-chat` (mode=auto) 는 confidence 기반 · pending tier 는 macro_confirm 만 발행. owner/super_admin bypass 미구현.
실무 흐름은 `pattern-dispatch` 를 통함.

## 관련 파일 (수정 시 함께 봐야)

- `app/counter/helpers/staffChatParser.ts` — 파서
- `app/counter/helpers/storeRegistry.ts` — 매장 alias
- `app/m/(app)/chat/[id]/ChatPatternAction.tsx` — client auto-fire
- `app/api/hostesses/provisional/route.ts` — 신규 hostess 생성
- `app/api/chat/pattern-dispatch/route.ts` — dispatch entry
- `app/api/chat/pattern-dispatch/[id]/confirm/route.ts` — auto-confirm · session + attendance
- `app/m/_hooks/useMobileData.ts` — useBuildingHostesses / useBuildingStores

## 체크리스트 (관련 코드 수정 시)

- [ ] parser 변경 시 → `scripts/parser_stress_200.mjs` 로 회귀 확인
- [ ] 새 매장 추가 시 storeRegistry + DB stores + service_types 세팅
- [ ] 신규 티켓 타입 시 TIME_SET + pricingLookup 확장
- [ ] provisional 수정 시 profiles/memberships/hostesses 스키마 3중 확인
- [ ] confirm route 수정 시 auto-attendance hook 유지
- [ ] cross-store 케이스 (origin != target) 시 transfer_request 자동 생성 유지
