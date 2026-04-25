# RLS Phase 8 Handoff — 071 / 072 / 073

> Status: **DRAFT, not applied to live.**
> Scope: `room_sessions`, `session_participants`, `orders` — realtime 구독 3종.
> 선행 완료: 067 hook, 068 rooms, 069 hostesses/store_memberships, 070 cross_store_work_records,
> useRooms realtime authed 전환, `/api/auth/realtime-token` 보안 하드닝.

---

## 1. 사전 확인 — 067 Custom Access Token Hook 활성

### 1-1. Dashboard UI

Supabase Dashboard → Authentication → Hooks → **Custom Access Token**

- Status 가 **Enabled** 인지 확인.
- Function 이 `public.custom_access_token_hook` 으로 지정됐는지 확인.
- Disabled 상태면 071 적용 시 authed client 는 `app_metadata.store_uuid` = NULL → 정책 0 rows → **카운터 전면 degrade**.

### 1-2. SQL 로 함수 존재/권한 확인

```sql
-- 함수 정의 존재
SELECT proname, prosrc IS NOT NULL AS has_body
  FROM pg_proc
 WHERE proname = 'custom_access_token_hook'
   AND pronamespace = 'public'::regnamespace;

-- supabase_auth_admin 에 EXECUTE 권한 (067 이 부여)
SELECT has_function_privilege(
  'supabase_auth_admin',
  'public.custom_access_token_hook(jsonb)',
  'EXECUTE'
) AS can_exec;
```

둘 다 `true` 여야 정상.

### 1-3. 실제 JWT claim 확인 (운영자 수동)

테스트 계정으로 로그인 후 `/api/auth/realtime-token` 응답의 `access_token` 을
<https://jwt.io> 등으로 디코드. Payload 에 다음 필드가 있어야 함:

```json
{
  "app_metadata": {
    "store_uuid": "<UUID>",
    "is_super_admin": false,
    ...
  },
  ...
}
```

자동 검증은 `scripts/rls/verify-rooms-authed.ts` 가 step [3] 에서 동일 확인.

### 1-4. JWT → RLS 경로 1-liner

임의 계정 JWT (e.g. 위에서 디코드한 토큰) 로:

```sql
-- 세션에 JWT claim 주입 (dashboard SQL Editor 에서)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"store_uuid":"<UUID>","is_super_admin":false}}',
  true);
SELECT count(*) FROM room_sessions
 WHERE store_uuid = '<same UUID>'::uuid;  -- >0 이어야 정책 통과
SELECT count(*) FROM room_sessions
 WHERE store_uuid = '<OTHER UUID>'::uuid; -- 0 이어야 차단 성공
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
```

---

## 2. 테이블 컬럼 조사 결과

### `room_sessions` (002:107-121)

| 컬럼 | 타입 | RLS 축 사용 |
|---|---|---|
| id | UUID PK | — |
| **store_uuid** | UUID NOT NULL | ✅ 정책 축 |
| room_uuid | UUID | — |
| business_day_id | UUID | — |
| status | TEXT | — (모든 상태 동일 가시) |
| started_at/ended_at/opened_by/closed_by | — | — |

단일 store_uuid 축. cross-store 개념 없음.

### `session_participants` (002:179-200 + 009:23)

| 컬럼 | 타입 | RLS 축 사용 |
|---|---|---|
| id | UUID PK | — |
| session_id | UUID → room_sessions(id) | — |
| **store_uuid** | UUID NOT NULL | ✅ J1 축 (working) |
| **origin_store_uuid** | UUID NULL (009 로 추가) | ✅ J2 축 (origin cross-store) |
| membership_id, manager_membership_id, transfer_request_id | — | — |
| role, category, time_minutes, price_amount, …_amount | — | — |
| status | TEXT DEFAULT 'active' | — |

Dual-column. 정책을 working/origin 으로 분리.

### `orders` (002:224-238)

| 컬럼 | 타입 | RLS 축 사용 |
|---|---|---|
| id | UUID PK | — |
| session_id | UUID → room_sessions(id) | — |
| **store_uuid** | UUID NOT NULL | ✅ 정책 축 |
| business_day_id, item_name, order_type, qty, unit_price, … | — | — |

단일 store_uuid 축.

---

## 3. 정책 설계 요약

| 테이블 | 정책 | 조건 |
|---|---|---|
| room_sessions | `select_jwt_store_uuid` | `store_uuid = JWT.store_uuid` |
| room_sessions | `select_jwt_super_admin` | `JWT.is_super_admin = true` |
| session_participants | `select_jwt_working_scope` | `store_uuid = JWT.store_uuid` (realtime 축) |
| session_participants | `select_jwt_origin_scope_cross_store` | `origin_store_uuid = JWT.store_uuid` AND row is cross-store |
| session_participants | `select_jwt_super_admin` | `is_super_admin` |
| orders | `select_jwt_store_uuid` | `store_uuid = JWT.store_uuid` |
| orders | `select_jwt_super_admin` | `is_super_admin` |

공통:
- `((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid` 패턴.
- `COALESCE(…::boolean, false) = true` 로 super_admin NULL-safe.
- WRITE 정책 정의 **안 함**. service_role BYPASSRLS 로 기존 경로 유지.

---

## 4. Rollback

단일 파일 `database/rollback/071_073_rls_realtime_tables_rollback.sql` — 정책 이름 기반 `DROP POLICY IF EXISTS` + (주석 처리된) RLS OFF 블록.

```bash
# 긴급 롤백 시:
psql "$DATABASE_URL" -f database/rollback/071_073_rls_realtime_tables_rollback.sql
```

검증:

```sql
SELECT schemaname, tablename, policyname, cmd
  FROM pg_policies
 WHERE tablename IN ('room_sessions','session_participants','orders')
 ORDER BY tablename, policyname;
```

`select_jwt_*` 계열 0건이면 롤백 성공.

---

## 5. Live apply 체크리스트 (다음 라운드에서 실행)

순서대로 확인한 뒤에만 apply.

- [ ] 067 hook **Enabled** (Dashboard 또는 1-2 SQL)
- [ ] 운영 계정 JWT 에 `app_metadata.store_uuid` 주입 확인 (1-3)
- [ ] `scripts/rls/verify-rooms-authed.ts` 기존 068/069 대상으로 all PASS
- [ ] `/api/auth/realtime-token` 200 응답 + useRooms 구독 정상 (DevTools WS frame)
- [ ] apply 순서: 071 → 072 → 073 (의존성 없음, 순서 자유지만 감사 로그 가독성)
- [ ] apply 직후 카운터 대시보드 5분 모니터링 — realtime 이벤트 수신 여부
- [ ] super_admin 계정 별도 verify — 전체 room_sessions count 확인
- [ ] rollback 파일 손닿는 위치 (즉시 실행 가능 상태)

---

## 6. 의존성 / 금지 사항

- **useRooms 는 authed 전환 완료**. anon fallback 없음. 071-073 apply 순간 authed 구독만 작동.
- `/api/auth/realtime-token` 이 401/403/429 로 막히면 realtime 무음 + 콘솔 warn. 고장 신호 확보됨.
- app 코드 수정 **금지** 유지. 본 라운드는 SQL draft 만.
- Realtime publication 설정은 이 migration 범위 외. Supabase Realtime 은
  기본 publication `supabase_realtime` 에 테이블이 포함돼야 하며 RLS 정책과
  별개. 이미 useRooms 가 3개 테이블 CDC 를 받고 있으므로 publication 은
  구성되어 있다고 가정. 미구성이면 apply 후에도 이벤트 0 → 재확인 필요.
