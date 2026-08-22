---
name: session-resolver
description: NOX session/room 관련 코드 작성 시 session_id SSOT · room_uuid canonical · room_no display-only 규칙 강제
---

# Session Resolver

세션/룸 코드 작성 전 반드시 실행.

## 핵심 규칙

1. **`session_id` = runtime SSOT (Single Source of Truth)**
   - 세션 lifecycle 조작 (extend, mid-out, checkout, settlement) 은 항상 `session_id` 기준
   - `session_id` 없이 room 만으로 세션 접근 금지

2. **`room_uuid` = canonical room identity**
   - 방 참조는 무조건 `room_uuid`. 변경 불가.
   - `active_session_id` 를 `room_uuid` 로 혼용 금지.

3. **`room_no` = display only**
   - UI 표시 전용. 식별자로 사용 시 reject.
   - 예: URL param `[room_uuid]` OK, `[room_no]` NO.

## 자주 하는 실수

- ❌ `sessions.select().eq("room_id", room_id)` — column 없음. `room_uuid` 사용.
- ❌ `session_id` 안 넘기고 `room_uuid` 만으로 checkout 시도 — active session 여러 개일 때 잘못된 session 종료 위험.
- ❌ WHERE 절에 `room_no` 사용 — display column, unique 아님.

## 정합성 체크

session/room 관련 code 편집 시:
- [ ] room 식별에 `room_uuid` 만 쓰는가
- [ ] session 조작에 `session_id` 를 명시적으로 전달받는가
- [ ] URL/API param naming 이 `room_uuid`, `session_id` 인가
- [ ] `active_session_id` 를 room 식별자와 혼용하지 않는가

## 참고

- Business date 로직: `lib/time/businessDate.ts` (KST). 세션이 자정 넘어도 `business_date` 는 시작 영업일.
- 세션 생성 race condition 은 migration 093 partial UNIQUE index 로 방지 중 (room_uuid + active).
