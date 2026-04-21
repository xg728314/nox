# NOX 버그 수정 기록

## round-058 ~ round-072 (2026-04-10 ~ 04-11)

5층(마블/라이브) 코드 완성 과정에서 발견 및 수정한 버그 10건.

---

### BUG-01: foxpro_checkout_session RPC 미존재

- **증상**: 체크아웃 시 500 에러. `supabase.rpc("foxpro_checkout_session")` 호출 실패.
- **원인**: `database/20260411_foxpro_checkout.sql`에 함수가 정의되어 있지만 **Supabase DB에 실제로 적용된 적 없음**. 누군가 JS 직접 UPDATE 로직을 RPC 호출로 교체했으나, DB에 함수가 없어 런타임 에러 발생.
- **수정 방법**: RPC 호출 제거, JS 직접 UPDATE 로직 복원 (room_sessions status='closed', session_participants status='left', audit_events INSERT).
- **수정 파일**: `app/api/sessions/checkout/route.ts`

---

### BUG-02: receipts.deleted_at 컬럼 미존재

- **증상**: 정산 조회 API에서 receipts가 항상 0건 반환. 에러 메시지 없이 빈 배열.
- **원인**: `receipts` 테이블에 `deleted_at` 컬럼이 **존재하지 않음**. 코드에서 `.is("deleted_at", null)` 필터를 사용하면 Supabase가 `42703 column does not exist` 에러를 반환하고, JS 코드는 에러를 무시하고 `receipts = null` → 빈 배열 처리.
- **수정 방법**: receipts 쿼리에서 `.is("deleted_at", null)` 한 줄 제거.
- **수정 파일**: `app/api/store/settlement/overview/route.ts`, `app/api/manager/settlement/summary/route.ts`

---

### BUG-03: settlement API 미존재 (deprecated 410)

- **증상**: 체크아웃 후 정산 데이터가 생성되지 않음. `/api/sessions/settlement` 호출 시 410 Gone.
- **원인**: settlement route가 deprecated 상태로 410만 반환. receipts INSERT 로직이 어디에도 없음. checkout API도 receipt를 생성하지 않음.
- **수정 방법**: settlement API를 완전히 새로 작성. store_settings에서 요율 조회 → participant_total + order_total 합산 → tc/manager/hostess 금액 계산 → receipts INSERT (draft) → audit_events 기록.
- **수정 파일**: `app/api/sessions/settlement/route.ts`

---

### BUG-04: business_day_id UTC vs KST 날짜 불일치

- **증상**: 한국시간 오전(09:00 이전)에 체크인하면 전날 영업일에 소속됨. 오늘(4/11) 영업일이 없어 정산 페이지가 빈 화면.
- **원인**: `new Date().toISOString().split("T")[0]`은 **UTC 기준** 날짜를 반환. KST 08:41 = UTC 23:41 (전날). 이로 인해 checkin의 business_date가 전날로 설정되고, 정산 조회에서 "오늘" 영업일이 없으면 빈 배열 반환.
- **수정 방법**: settlement overview/summary API에 fallback 로직 추가: 오늘 영업일 없으면 → `store_operating_days WHERE status='open' ORDER BY business_date DESC LIMIT 1` (가장 최근 open 영업일 사용).
- **수정 파일**: `app/api/store/settlement/overview/route.ts`, `app/api/manager/settlement/summary/route.ts`

---

### BUG-05: store/staff "이름 없음" 표시

- **증상**: 스태프 목록에서 모든 아가씨/실장 이름이 "이름 없음"으로 표시.
- **원인**: `profiles.full_name`만 조회했는데, 대부분의 계정에서 full_name이 null. 실제 활동명(source name)은 `managers.name` / `hostesses.name` 테이블에 저장됨.
- **수정 방법**: managers/hostesses 테이블에서 membership_id 기준으로 활동명 조회 → 3단계 fallback: `stageNameMap.get(id) || profiles?.[0]?.full_name || "이름 없음"`.
- **수정 파일**: `app/api/store/staff/route.ts`

---

### BUG-06: orders POST 500 에러 (business_day_id null)

- **증상**: 주문 추가 시 간헐적 500 에러. DB constraint violation.
- **원인**: `orders.business_day_id`는 NOT NULL FK인데, `session.business_day_id`가 null인 세션이 존재. null 값으로 INSERT 시도 → PostgreSQL FK constraint 위반 → 500.
- **수정 방법**: INSERT 전에 `if (!session.business_day_id)` null 체크 추가, 400 `BUSINESS_DAY_NOT_FOUND` 에러 반환.
- **수정 파일**: `app/api/sessions/orders/route.ts`

---

### BUG-07: resolveAuthContext 미승인 멤버십 에러코드 부정확

- **증상**: 미승인(pending/rejected) 멤버십으로 로그인 시 `MEMBERSHIP_NOT_FOUND` 에러 반환. 사용자에게 "멤버십이 없다"는 오해 유발.
- **원인**: DB 쿼리에 `.eq("status", "approved")`가 포함되어, 미승인 멤버십은 쿼리 결과에서 제외 → "없음"으로 처리. 실제로는 멤버십이 존재하지만 미승인 상태.
- **수정 방법**: DB 쿼리에서 `.eq("status", "approved")` 제거. 코드 레벨에서 status 확인 후 `MEMBERSHIP_NOT_APPROVED` (미승인) vs `MEMBERSHIP_NOT_FOUND` (진짜 없음) 분리 반환.
- **수정 파일**: `lib/auth/resolveAuthContext.ts`

---

### BUG-08: 정산 조회 "최신 1건만" 로직 결함

- **증상**: 아가씨가 여러 세션에 참여하고 일부만 정산된 경우, "정산 없음"으로 표시. 정산 데이터가 있는데도 보이지 않음.
- **원인**: overview/summary API가 아가씨별로 `entered_at DESC LIMIT 1`로 최신 참여 1건만 조회 → 해당 세션의 receipt만 확인. 최신 세션에 receipt가 없으면 이전 세션의 receipt는 무시됨.
- **수정 방법**: business_day_id 기준으로 전체 세션 조회 → 전체 참여 레코드 일괄 조회 → 전체 receipts 매칭 → 아가씨별 금액 합산. N+1 쿼리(아가씨 수 × 2회) → 고정 6회 쿼리로 개선.
- **수정 파일**: `app/api/store/settlement/overview/route.ts`, `app/api/manager/settlement/summary/route.ts`

---

### BUG-09: `: any` 타입 19개

- **증상**: `npx tsc --noEmit` 통과하지만 타입 안전성 없음. `.map((x: any) => ...)` 패턴에서 필드명 오타 감지 불가.
- **원인**: Supabase `.select()` 반환 타입이 복잡하여 개발 시 `any`로 우회한 것으로 추정.
- **수정 방법**: 19개 `.map()` 콜백에 정확한 타입 명시. 일부 파일은 인터페이스 정의 (PresenceRow, BleEvent, MembershipRow 등).
- **수정 파일**: 19개 API route 파일 (상세 목록은 state.json round_072_details 참조)

---

### BUG-10: Supabase FK 조인 배열 반환 패턴

- **증상**: `profiles.full_name`이 undefined. 타입을 `{ full_name: string } | null`로 지정했는데 tsc 6건 에러.
- **원인**: Supabase FK 조인 (`.select("profiles!fk(full_name)")`)의 반환 타입은 **항상 배열** `{ full_name: string }[]`이지, 단일 객체 `{ full_name: string } | null`이 아님. `m.profiles?.full_name` 접근 시 undefined.
- **수정 방법**: 타입을 `{ full_name: string }[] | null`로 변경, 접근을 `?.[0]?.full_name`으로 통일. 6개 파일 일괄 적용.
- **수정 파일**: `store/staff`, `manager/dashboard`, `manager/hostesses`, `me/sessions` 등 6개

---

## 교훈 및 주의사항 (6/7/8층 작업 시 참고)

### DB 스키마

1. **`database/002_actual_schema.sql`이 유일한 소스**. `001`은 deprecated, `20260411_foxpro_*.sql`은 DB 미적용. 새 테이블/컬럼 추가 시 반드시 002를 기준으로 확인.
2. **컬럼 존재 여부를 코드로 가정하지 말 것.** `deleted_at`이 있는 테이블(session_participants, store_memberships)과 없는 테이블(receipts, orders)이 혼재. `.is("deleted_at", null)` 사용 전 002 스키마에서 확인.
3. **Supabase RPC 함수는 3개만 존재**: `get_user_membership_id`, `get_user_role`, `get_user_store_uuid`. 새 RPC 사용 시 반드시 DB에 함수가 존재하는지 확인.

### Supabase 쿼리 패턴

4. **FK 조인은 항상 배열 반환.** `.select("profiles!fk(full_name)")` → `profiles: { full_name: string }[]` (배열). 접근: `?.[0]?.full_name`. 단일 객체(`| null`)로 타입 지정하면 tsc 에러.
5. **`.single()` vs `.maybeSingle()`**: 결과 없을 때 `.single()`은 에러, `.maybeSingle()`은 null 반환. 존재하지 않을 수 있는 레코드는 반드시 `.maybeSingle()` 사용.
6. **Supabase 쿼리 에러가 조용히 무시될 수 있음.** `.is("deleted_at", null)`에서 컬럼 미존재 시 `data = null` + `error` 반환되지만, `(data ?? [])` 패턴으로 빈 배열 처리 → 에러가 보이지 않음. error 체크 필수.

### 날짜/시간

7. **`new Date().toISOString()`은 UTC 기준.** 한국(KST, UTC+9)에서 오전 09:00 이전 = UTC 기준 전날. business_date 계산 시 주의. 현재 checkin은 UTC 기준으로 동작하며, 이것이 의도된 설계인지 확인 필요.
8. **business_day_id 필터 필수.** 날짜 기반 집계에서 `created_at`이나 calendar date 대신 반드시 `business_day_id` 사용 (CLAUDE.md 도메인 규칙).

### API 설계

9. **settlement은 서버 계산 전용.** 클라이언트가 금액을 제출하는 것은 금지. rates는 `store_settings` 테이블에서 조회. 기본값: tc=0.2, manager=0.7, hostess=0.1, rounding_unit=1000.
10. **checkout과 settlement은 별개 API.** checkout은 세션 close만 담당, settlement은 receipt 생성만 담당. counter UI에서 checkout 성공 후 settlement을 순차 호출.
11. **활동명은 managers/hostesses 테이블에 저장.** `profiles.full_name`은 비어있는 경우가 많음. 이름 표시 시 반드시 `managers.name` / `hostesses.name` 먼저 조회.

### 코드 품질

12. **`: any` 사용 금지.** Supabase `.map()` 콜백에서 정확한 타입 명시. FK 조인 배열 패턴을 숙지하고 적용.
13. **console.log/console.error 제거.** 디버그용 로그는 작업 완료 후 반드시 제거. `[checkin]` 태그 로그 2건은 의도적 유지.
