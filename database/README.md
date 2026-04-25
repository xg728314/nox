# NOX Database Migrations

**최종 실사**: 2026-04-24 (Round 1)  
**Supabase project**: `piboecawkeqahyqbcize` (nox, ACTIVE_HEALTHY)

---

## 현재 상태 요약

| 항목 | 수치 |
|---|---|
| 로컬 migration 파일 (root) | 76 |
| Supabase `list_migrations` 기록 | 36 |
| 실 DB 테이블 (public) | 65 |
| 실 DB RPC | 37 |
| 실 DB CHECK | 61 |
| 실 DB 인덱스 | 214 |
| 실 DB 트리거 | 17 |
| RLS 활성 테이블 | 24 |
| RLS 정책 | 70 |

---

## 파일 카테고리

### 🟢 Applied + 이름 일치 (정상)
`010, 014, 015, 016, 017, 030~035, 039, 040, 042, 045~051, 077~079, 075`

### 🟡 Applied — 이름 alias (파일명 ≠ Supabase 기록명)

| Supabase 기록명 | 로컬 파일 |
|---|---|
| `step_011d_payout_and_cross_store_normalization` | `036_payout_and_cross_store_normalization.sql` |
| `step_011e_settlement_payout_hardening` | `037_settlement_payout_hardening.sql` |
| `step_011f_cross_store_legacy_drop` | `038_cross_store_legacy_drop.sql` |
| `chat_rooms_close_fields` | `028_chat_rooms_close_fields.sql` |
| `chat_participants_pinned_at` | `029_chat_participants_pinned_at.sql` |
| `044_auth_rate_limits_and_security_logs` | `052_auth_rate_limits.sql` |
| **`080_manager_prepayments`** | **`043_manager_prepayments.sql`** |

**주의**: 로컬 파일은 **rename 하지 않음**. git 이력 보존 + grep 검색 안정성 우선.

### 🟠 Applied but NOT in `list_migrations` (약 20개)
Supabase migrations CLI 가 아닌 경로 (SQL editor / MCP) 로 적용됨. 실 DB 객체 존재 확인 완료.

주요:
- `003_credits`, `005_chat`, `006_pre_settlements`, `007_inventory`, `008_business_rules`, `009_cross_store_settlement`
- `011_participant_time_amounts`, `012_session_manager`, `013_participant_exit_type`
- `041_atomic_stock_increment`
- `054_location_correction_logs`, `055_grant_super_admin`, `056_ble_presence_history`, `058_session_participants_name_edited_at`
- `059_staff_work_logs` (실제로는 `cross_store_work_records` 테이블 생성)
- **RLS 시리즈 전부**: `064, 066, 067, 068, 069, 070`
- `076_cross_store_items_check_constraints`
- `20260411_staff_attendance`, `20260411_store_service_types`

### 🔴 Round 3 의사결정 결과 (2026-04-24)

| 파일 | Round 3 결정 | 사유 |
|---|---|---|
| `053_store_memberships_primary_unique.sql` | ✅ **APPLIED** | 사전 실사 중복 0건 → safe apply |
| `062_staff_attendance_uniq_open.sql` | ✅ **APPLIED** | 사전 실사 중복 open 출근 0건 → safe apply |
| `063_session_participants_fk_fix.sql` | ✅ **APPLIED (no-op)** | 제약 이미 없음. idempotent DROP 실행 → history 기록 |
| `057_profiles_must_change_password.sql` | 🟡 **DEFERRED** | invite 흐름 미사용. apply 해도 dead column. 기능 활성화 시 재검토 |
| `060_cross_store_items_work_log_link.sql` | 🟡 **DEFERRED** | `staff_work_logs` 테이블 부재 → apply 자체 불가. 대체 경로 075 운영 중 |
| `061_phase4_convention_fix.sql` | 🔴 **SKIP (INCOMPATIBLE)** | 전제 컬럼들 전부 부재 (staff_work_log_id, header.store_uuid 등). apply 시 에러 확정. 참조용으로만 보존 |

### ⚫ Applied but **파일 없음**
- `043_super_admin_global_roles` — Supabase 에 apply 됐지만 로컬 파일 없음. `user_global_roles` 테이블 관련.

### ⚪ 특수 파일 (non-migration)

| 파일 | 성격 |
|---|---|
| `000_migration_tracker.sql` | meta |
| `001_initial_schema.sql` | **DEPRECATED** — apply 금지 |
| `002_actual_schema.sql` | 실 DB 스냅샷 (2026-04-11 시점, 참조용) |
| `20260411_foxpro_checkout.sql` | **NEVER APPLIED** |
| `BUGLOG.md` | 버그 로그 문서 |
| `checks/verify_cross_store_settlement_runtime.sql` | 운영 검증 스크립트 |
| `rollback/071_073_rls_realtime_tables_rollback.sql` | 롤백 스크립트 (071-073 은 한때 apply 됐다가 롤백) |
| `migrations/003_cross_store.sql` | 하위 디렉터리 — 정체 불명, 조사 필요 |
| `drafts/` | 작업중 초안 |

---

## 번호 공백

`071, 072, 073, 074` — 파일 없음. `rollback/071_073_rls_realtime_tables_rollback.sql` 로 추정컨대 한때 apply → 롤백.

---

## 신규 migration 작성 규칙

1. **번호는 Supabase 에 apply 될 때 할당**되는 것을 원칙.
   - 예: 로컬 파일명이 `043_X.sql` 이어도 실 apply 시 slot 충돌이면 `080_X.sql` 로 기록됨.
   - 로컬 파일은 rename 하지 말고 **이 문서에 alias 기록**.

2. **apply 는 Supabase MCP `apply_migration` 사용** (권장).
   - SQL editor 직접 실행은 `list_migrations` 에 기록 안 됨 → 추적 어려움.

3. **DDL 변경 전 실 DB 실사**:
   - `information_schema.columns` / `pg_constraint` / `pg_proc` 확인
   - 로컬 파일과 실 DB 가 일치한다고 **가정하지 말 것**.

4. **신규 파일 header 주석 필수**:
   - 목적 (목표)
   - 대상 테이블/RPC
   - 선행 조건 (다른 migration 의존성)
   - 멱등성 (IF NOT EXISTS 등)
   - 롤백 방법

5. **RPC 재정의 시**:
   - 파라미터 변경이면 `DROP FUNCTION IF EXISTS` 선행 (signature overload 방지).
   - 계산 로직 변경은 **금지** (schema drift fix 만 허용) — 변경 시 별도 반드시 승인.

---

## 신규 환경 재생성 (예: staging)

**현재는 1-step 재생성 불가**. 이유:
- `list_migrations` 가 불완전 (36개만 기록, 실 60+ 개 apply)
- 파일 번호 ↔ apply 번호 불일치

**해결책 (Round 4 예정)**: `_baseline_YYYY-MM-DD.sql` 통합 스냅샷 파일 생성 → 신규 환경은 이 하나만 apply.

---

## 변경 이력

- **2026-04-24 (Round 1-2)**: 최초 실사 + README 생성. CLAUDE.md 갱신. RLS 상태 실제와 맞춤.
- **2026-04-24 (Round 3)**: 미적용 migration 개별 의사결정.
  - 053 / 062 / 063 apply (각 사전 실사 후 safe 판정)
  - 057 / 060 deferred (기능 미사용 / 전제 부재)
  - 061 skip (INCOMPATIBLE — 전제 컬럼 부재로 apply 시 확정 에러)
  - 이후 `list_migrations` 에 3건 추가됨 (053, 062, 063).
- **2026-04-24 (Round 4)**: Baseline 디렉터리 생성.
  - `_baseline_2026-04-24/` 디렉터리: STATE.md + 02_constraints.sql + 03_indexes.sql + 04_functions.txt + 05_triggers.txt + 06_rls_policies.txt
  - `scripts/db-baseline-pull.sh`: 공식 재생성 스크립트 (supabase db pull 래퍼)
  - hand-craft SQL 은 의도적으로 skip — 공식 도구 (`supabase db pull`) 이 정석.
