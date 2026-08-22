---
name: migration-guard
description: NOX DB migration (SQL) 작성/적용 시 넘버링 · alias 관리 · fallback 패턴 · 043 slot 충돌 회피 규칙
---

# Migration Guard

129개 migration + 파일명 alias 존재. 무작정 새 파일 만들면 conflict.

## 넘버링 규칙

1. **최신 번호 확인 후 +1**
   ```bash
   ls database/*.sql | tail -5
   ```
   현재 최대: `database/174_chat_types_and_learning.sql`

2. **3자리 zero-pad** (001, 002 ... 999)
   - 예외: `20260411_*.sql` 등 legacy timestamp 파일 존재 (건드리지 말 것)

3. **파일명 = 실제 apply 이름** 최대한 일치
   - Supabase migration history 는 `step_XXX` 접두사 자동 붙일 수 있음
   - **CLAUDE.md 의 파일명 alias 표** 참조 필수

## 파일명 alias (실 apply 이름 ↔ 로컬 파일명)

| Supabase history | 로컬 파일 |
|---|---|
| `step_011d_payout_and_cross_store_normalization` | `036_payout_and_cross_store_normalization.sql` |
| `chat_rooms_close_fields` | `028_chat_rooms_close_fields.sql` |
| `044_auth_rate_limits_and_security_logs` | `052_auth_rate_limits.sql` |
| **`080_manager_prepayments`** | **`043_manager_prepayments.sql`** ← 043 slot 충돌로 80 으로 apply |
| `043_super_admin_global_roles` | (로컬 파일 없음 — SQL 에디터 직접 생성) |

**교훈**: 043 slot 처럼 이미 apply 된 번호 재사용 금지. `list_migrations` MCP tool 로 실 apply 확인 후 결정.

## 적용 방법

### Option A: Supabase MCP (권장)
```typescript
mcp__supabase__apply_migration({ name, query })
```

### Option B: Supabase Dashboard SQL Editor
- 큰 변경 / 트리거 / RLS 정책은 이쪽 권장 (실행 결과 눈으로 확인)
- 적용 후 로컬 파일에도 반드시 커밋

### Option C: `database/APPLY_ALL_MISSING.sql`
- 여러 pending migration 일괄 적용용 스크립트 (수동 관리)

## 미적용 migration 대응 (fallback 패턴)

앱 코드가 신규 컬럼/테이블 참조하는데 migration 미apply 상황:

### 컬럼 미존재 (`42703`)
```typescript
const buildQuery = (withNewCols: boolean) => {
  const cols = withNewCols
    ? "id, ..., new_col_1, new_col_2"
    : "id, ..."
  return supabase.from("t").select(cols)...
}
const primaryRes = await buildQuery(true)
if (primaryRes.error?.code === "42703") {
  const fb = await buildQuery(false)
  messages = fb.data
} else {
  messages = primaryRes.data
}
```

### 테이블 미존재 (`42P01`)
```typescript
if (error?.code === "42P01") {
  return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
}
```

이유: 프로덕션에 migration 순차 적용 중일 때 앱 crash 방지.

## RLS 상태 (2026-04-24 실사)

- **RLS 활성 24개 테이블** (mig 064~070 적용됨)
- **앱 route 는 service-role key 사용** → RLS 우회
- 일반 user JWT 직접 쿼리 시에만 RLS 정책 적용

## 미적용 목록 (2026-08 기준)

- `060_cross_store_items_work_log_link.sql` — staff_work_log_id 컬럼 등 부재
- `20260411_foxpro_checkout.sql` — 절대 apply 안 됨 (deprecated)

## 체크리스트

- [ ] 최신 번호 확인 후 +1
- [ ] alias 표에서 conflict 없는지 확인
- [ ] MCP `list_migrations` 로 실 apply 확인
- [ ] 컬럼 추가 시 앱 코드 fallback (42703) 준비
- [ ] 테이블 추가 시 앱 코드 fallback (42P01) 준비
- [ ] 커밋 시 `database/README.md` alias 갱신
- [ ] RLS 활성 테이블이면 policy 도 함께 정의
