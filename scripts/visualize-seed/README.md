# Visualize Seed

Test fixture for `/super-admin/visualize/network` (Jarvis network map) verification.

Creates a self-contained, marked-as-test data set under two reserved store UUIDs so the operational data is never touched.

## What gets created

| 카테고리 | 개수 | 비고 |
|---|---|---|
| stores | 2 | `[TEST] 시드매장 A` (5F), `[TEST] 시드매장 B` (6F) — UUIDs `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01/02` |
| auth users + profiles | 6 | 이메일 `*@nox-seed.test`, 한국 이름 |
| rooms | 4 | 매장당 2 |
| store_settings + service_types | 2 + 2 | 체크인 안전성 확보 |
| store_memberships | 6 | owner/manager/hostess 분포 |
| managers / hostesses | 2 / 3 | 디스플레이 행. hostess A1/A2 는 manager A 가 담당 (managed_by 엣지) |
| store_operating_days | 2 | 오늘 KST 영업일 |
| room_sessions | 3 | 모두 closed. A 매장 2개, B 매장 1개 (cross-store 호스티스 포함) |
| session_participants | 5 | 1개는 origin_store_uuid=A, store_uuid=B (worked_at 엣지) |
| orders | 3 | 양주/안주/팁 |
| receipts | 3 | 2 finalized + 1 draft |
| settlements | 2 | 모두 confirmed |
| settlement_items | 7 | manager/hostess/store role 분포 |
| payout_records | 4 | 3 approved + 1 rejected (risk 색 시그널) |
| cross_store_settlements | 1 + 1 item | B → A, remaining 50,000원 (warning 색 + owes_to 엣지) |
| audit_events | 7 | finalize/edit/reject/force_leave/override_price/approve 혼합 |

총 ~50 row.

## Usage

### Environment

```bash
export NEXT_PUBLIC_SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...   # service-role; never check in
# optional:
export SEED_PASSWORD=Test1234!         # default if not set
```

### Seed

```bash
npx tsx scripts/visualize-seed/seed.ts
```

- Idempotent on core (auth/profiles/stores/etc.) — re-run is safe.
- Transactional layer (sessions/settlements/payouts/etc.) is all-or-nothing: if any test session already exists, the script logs and skips. Run cleanup first to re-seed.

### Cleanup

```bash
# Preview (always safe, never deletes)
npx tsx scripts/visualize-seed/cleanup.ts

# Actually delete
npx tsx scripts/visualize-seed/cleanup.ts --confirm
```

The dry-run prints the row counts that would be deleted per table. Pass `--confirm` only after reviewing.

### SQL Backup Cleanup

If `tsx`/Node is unavailable, use the SQL fallback:

```
database/cleanup_visualize_seed.sql
```

Open in the Supabase SQL editor, run the SELECT block first to preview, then uncomment the DELETE block. Note: SQL editor cannot delete `auth.users` — those must be removed via the TS cleanup or the Supabase Auth UI.

## Safety guarantees

1. **Operational data never touched**: every INSERT/DELETE is filtered by either `store_uuid IN (TEST_STORE_UUIDS)` or auth user email pattern `%@nox-seed.test`.
2. **Deterministic UUIDs**: collision with `gen_random_uuid()` requires 32 specific outcomes — practically zero.
3. **Pre-flight check**: seed verifies the test store UUID isn't already taken by a non-test row before inserting.
4. **Cleanup runtime assertion**: the script aborts if any resolved store UUID falls outside the constants list.
5. **Dry-run default**: cleanup never deletes without `--confirm`.

## Files

```
scripts/visualize-seed/
  constants.ts        — UUIDs, accounts, stores, rooms (single source of truth)
  seed.ts             — main seed (idempotent)
  cleanup.ts          — main cleanup (dry-run default)
  README.md           — this file

database/
  cleanup_visualize_seed.sql   — SQL fallback (DB rows only; no auth.users)
```

## After seeding

Visit `/super-admin/visualize/network` (super_admin login required):

- 빌딩 전체 보기 → 5F + 6F 컬럼에 [TEST] 매장 등장.
- 단일 매장 → A 또는 B 선택. A 시 자동 selection (P2.1t).
- worked_at 엣지: hostess `이서연(서연)` → store B (cross-store 표시).
- owes_to 엣지: store B → store A (amber dashed, status=warning).
- payout 노드: rejected 1개 (red glow + dashed reversal edge).
- audit 노드: settlements/payout 카테고리에 ~5개 cluster, severity 색 mix.

## Re-seed cycle

```bash
npx tsx scripts/visualize-seed/cleanup.ts --confirm
npx tsx scripts/visualize-seed/seed.ts
```
