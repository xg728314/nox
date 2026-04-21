# STEP-009.7 — CHAT READ ENHANCEMENT

## OBJECTIVE

채팅 읽음 처리를 room-level unread에서 한 단계 더 올려서,
메시지 단위 읽음 상태와 "누가 읽었는지"를 볼 수 있도록 고도화한다.

기존 구조/보안/권한/store scope/chat lifecycle을 절대 깨지 않는다.

---

## CURRENT STATE

현재 채팅은 다음 상태까지 완료되어 있다.

- REST-only
- realtime 제거
- unread polling 안정화 완료
- leave / close 완료
- group / direct / store / room_session lifecycle 분기 완료
- room-level unread badge 동작 중

현재 unread는 "방 단위 안 읽음"까지만 안정화된 상태다.

이번 STEP-009.7에서는 다음을 추가한다.

1. message-level read
2. last-read cursor
3. 누가 읽었는지 표시 가능한 기반
4. 기존 unread badge와 충돌 없이 동작

---

## SCOPE

이번 단계에서 구현할 것:

- 메시지별 읽음 상태 기록 테이블 추가
- 사용자가 방을 열거나 메시지 목록을 볼 때 읽음 반영 API 추가
- 각 메시지에 대해 읽은 멤버 목록 또는 count를 계산할 수 있는 구조 추가
- UI에서 최소한의 read indicator 표시 기반 마련

이번 단계에서 하지 말 것:

- realtime 읽음 동기화
- push 알림
- typing indicator
- delivery status
- 파일 전송

---

## DB DESIGN

### 1. chat_message_reads

각 멤버가 어느 메시지까지 읽었는지 또는 특정 메시지를 읽었는지 기록하는 테이블

권장 구조:

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- room_id uuid not null
- message_id uuid not null
- membership_id uuid not null
- read_at timestamptz not null default now()
- created_at timestamptz not null default now()

제약:
- unique(room_id, message_id, membership_id)

설명:
- 동일 사용자가 동일 메시지를 여러 번 읽음 처리하지 않도록 중복 방지

---

### 2. OPTIONAL CURSOR TABLE (권장)

message-level row만으로도 가능하지만, 성능/집계를 위해 cursor도 함께 두는 것이 좋다.

#### chat_read_cursors

- id uuid primary key default gen_random_uuid()
- store_uuid uuid not null
- room_id uuid not null
- membership_id uuid not null
- last_read_message_id uuid null
- last_read_at timestamptz null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

제약:
- unique(room_id, membership_id)

설명:
- unread 계산과 "마지막으로 어디까지 읽었는지" 추적용
- message_reads는 상세 근거
- read_cursor는 빠른 참조용

둘 다 구현해도 되고, 최소 구현은 read_cursors 우선 + message_reads 보조 방식도 허용

---

## API DESIGN

### 1. POST /api/chat/rooms/[id]/read

목적:
- 현재 사용자가 특정 room의 메시지를 읽음 처리

동작:
- room 접근권한 검증
- 본인이 active participant인지 검증
- room이 closed면 정책 결정:
  - 조회는 가능하더라도 읽음 처리는 허용 가능
  - 단, room_session closed 후 새 메시지는 없으므로 안전
- 가장 최근 message 기준으로 read cursor 갱신
- 필요한 경우 message_reads insert/upsert

응답:
- success true
- room_id
- last_read_message_id
- read_at

---

### 2. GET /api/chat/rooms/[id]/messages

기존 메시지 조회 API를 확장하되, 기존 응답 구조를 최대한 깨지 말 것.

추가 가능 필드 예시:

각 message에 대해:
- is_read_by_me
- read_count
- read_by (optional, 최소 정보만)

주의:
- 과도한 payload 금지
- 처음에는 read_count + 마지막 메시지 기준 read_by_me 정도만 허용 가능
- "누가 읽었는지" 전체 배열은 group 인원 많은 경우 부담될 수 있으므로 optional

---

### 3. GET /api/chat/unread

기존 unread API와 충돌 금지

필수:
- 기존 room-level unread badge 동작 유지
- unread 계산은 read cursor 또는 message_reads 기준으로 신뢰성 있게 동작해야 함

---

## SERVER RULES

### 필수 권한 규칙

- resolveAuthContext 사용
- store_uuid 절대 스코프
- chat_participants 기반 접근 제어
- left_at is null 또는 접근 허용 정책 명확히 유지
- cross-store 차단

### 읽음 처리 가능 대상

- direct
- group
- store
- room_session

단, 접근 가능한 방만 허용

### 금지

- 다른 사용자의 read 상태 임의 수정
- store_uuid 없는 읽음 처리
- membership_id를 request body에서 신뢰
- closed room에 새 message 생성 허용

---

## UI / HOOK RULES

### Hook 추가/수정

기존 hooks를 존중해서 최소 변경

예상 대상:
- app/chat/hooks/useChatMessages.ts
- 필요 시 useChatUnread.ts 보완

### 추가할 동작

- 방 열람 시 read API 호출
- 메시지 목록 진입 후 debounce 또는 safe timing으로 mark-as-read
- 과도한 중복 호출 방지

### 금지

- component 내부 fetch
- page에 business logic 추가
- realtime 재도입

---

## UI GOAL

최소 구현 기준:

1. 내가 읽은 마지막 상태 반영
2. unread badge가 읽은 뒤 줄어들어야 함
3. 각 메시지에 대해 최소한의 read 상태 기반 마련
4. 향후 "누가 읽었는지" 확장 가능한 구조

선택 구현:
- 마지막 내 메시지 아래 "읽음 N" 또는 "N명 읽음"
- direct chat에서는 상대가 읽었는지 단순 표시
- group에서는 count 기반 표시 우선

---

## PERFORMANCE RULES

- 읽음 API 연타 금지
- 동일 room 진입 시 불필요한 중복 upsert 최소화
- hidden tab에서 무의미한 read 호출 금지
- polling 구조와 충돌 금지
- unread polling cadence 7s 유지

---

## MIGRATION RULES

필요한 migration 파일 추가

예:
- database/030_chat_message_reads.sql
- database/031_chat_read_cursors.sql

반드시 live schema drift를 고려해서 IF NOT EXISTS 사용 가능하면 사용

---

## VALIDATION

반드시 검증할 것:

1. 사용자가 room 진입
   - 최신 메시지까지 read 반영
2. unread badge 감소
3. direct chat에서 상대 읽음 여부 기반 확인 가능
4. group chat에서 read count 계산 가능
5. left_at 처리된 사용자는 읽음 처리 불가 또는 정책 일관
6. cross-store room read 차단
7. closed room에서 read 처리/조회 정책 일관
8. npx tsc --noEmit 통과

---

## FAIL IF

다음 중 하나라도 있으면 FAIL

- 기존 unread badge 깨짐
- hook에 navigation 추가
- realtime 재도입
- component fetch 추가
- store_uuid 누락
- 다른 사용자 read 상태 수정 가능
- existing chat leave/close lifecycle 깨짐

---

## OUTPUT FORMAT

Return only final report:

1. FILES CHANGED
2. DB CHANGES
3. API CHANGES
4. HOOK/UI CHANGES
5. VALIDATION RESULT
6. KNOWN LIMITS

Do not summarize outside the final report.