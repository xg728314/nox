-- ============================================================
-- verify_cross_store_settlement_runtime.sql
--
-- 운영 배포 직후 실행하여 migration 075/076 적용 + 런타임 데이터 건강성을
-- 점검한다. 읽기 전용 — 어떤 mutation 도 없다.
--
-- 실행: Supabase Dashboard → SQL Editor 에 전체 붙여넣기.
--
-- 각 블록의 expected 값은 주석으로 명시. 기대와 다르면 운영자가
-- 즉시 조치해야 한다 (RUNBOOK.md 의 "흔한 에러" 참고).
-- ============================================================

-- ── [1] migration 075: cross_store_work_record_id 컬럼 존재 ───
-- expected: 1 row (data_type = uuid)
SELECT
  '[1] cssi.cross_store_work_record_id column'     AS check_name,
  column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'cross_store_settlement_items'
  AND column_name  = 'cross_store_work_record_id';

-- ── [2] migration 075: FK cssi_cswr_fk 존재 ──────────────────
-- expected: 1 row
SELECT
  '[2] FK cssi_cswr_fk'                             AS check_name,
  conname, contype
FROM pg_constraint
WHERE conname = 'cssi_cswr_fk';

-- ── [3] migration 075: unique index 존재 ─────────────────────
-- expected: 1 row
SELECT
  '[3] uq_cssi_cross_store_work_record index'       AS check_name,
  indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname  = 'uq_cssi_cross_store_work_record';

-- ── [4] migration 076: CHECK constraints 4종 존재 ────────────
-- expected: 4 rows
SELECT
  '[4] cssi CHECK constraints'                      AS check_name,
  conname
FROM pg_constraint
WHERE conname IN (
  'cssi_amount_non_negative',
  'cssi_paid_amount_non_negative',
  'cssi_remaining_amount_non_negative',
  'cssi_status_check'
)
ORDER BY conname;

-- ── [5] 데이터 건강성: 금액 음수 row 존재 여부 ───────────────
-- expected: 0 rows (각 행)
SELECT
  '[5a] amount < 0 rows'                            AS check_name,
  count(*) AS n
FROM cross_store_settlement_items
WHERE amount < 0
  AND deleted_at IS NULL;

SELECT
  '[5b] paid_amount < 0 rows'                       AS check_name,
  count(*) AS n
FROM cross_store_settlement_items
WHERE paid_amount < 0
  AND deleted_at IS NULL;

SELECT
  '[5c] remaining_amount < 0 rows'                  AS check_name,
  count(*) AS n
FROM cross_store_settlement_items
WHERE remaining_amount < 0
  AND deleted_at IS NULL;

-- ── [6] status 이상값 존재 ───────────────────────────────────
-- expected: 0 rows. 레거시 row 에 'settled' 등 남아있을 수 있음 — RUNBOOK §troubleshoot 참고.
SELECT
  '[6] status outside whitelist'                    AS check_name,
  status, count(*) AS n
FROM cross_store_settlement_items
WHERE deleted_at IS NULL
  AND status IS NOT NULL
  AND status NOT IN ('open','pending','partial','completed','cancelled','closed')
GROUP BY status
ORDER BY n DESC;

-- ── [7] manager_membership_id null 이면서 remaining_amount > 0 인 item ──
-- expected: 0 또는 운영 대기 건수. 보정 전에는 선지급/지급 불가.
SELECT
  '[7] null manager with remaining > 0'             AS check_name,
  count(*) AS n,
  COALESCE(sum(remaining_amount), 0) AS total_remaining
FROM cross_store_settlement_items
WHERE manager_membership_id IS NULL
  AND remaining_amount > 0
  AND deleted_at IS NULL
  AND status NOT IN ('completed','cancelled','closed');

-- ── [8] cross_store_work_record_id 없는 신규 item 수 ────────
-- expected: legacy 집계 라인 + 이전 staff_work_log_id 라인만. 숫자 기록용.
SELECT
  '[8] items without cross_store_work_record_id'    AS check_name,
  count(*) FILTER (WHERE staff_work_log_id IS NOT NULL) AS legacy_staff_work_log_linked,
  count(*) FILTER (WHERE staff_work_log_id IS NULL)     AS legacy_manager_aggregate_rows
FROM cross_store_settlement_items
WHERE cross_store_work_record_id IS NULL
  AND deleted_at IS NULL;

-- ── [9] 신규 aggregate 로 연결된 item 수 (참고 카운트) ──────
-- expected: aggregate 를 한 번이라도 실행했다면 > 0.
SELECT
  '[9] items with cross_store_work_record_id'       AS check_name,
  count(*)                                          AS n,
  count(DISTINCT cross_store_work_record_id)        AS distinct_records_linked
FROM cross_store_settlement_items
WHERE cross_store_work_record_id IS NOT NULL
  AND deleted_at IS NULL;

-- ── [10] 고아 item 탐지: cross_store_work_record_id 가 없는 work_record 를 가리킴 ──
-- expected: 0 rows
SELECT
  '[10] orphan items (record missing)'              AS check_name,
  count(*) AS n
FROM cross_store_settlement_items i
WHERE i.cross_store_work_record_id IS NOT NULL
  AND i.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM cross_store_work_records r
    WHERE r.id = i.cross_store_work_record_id
      AND r.deleted_at IS NULL
  );

-- ── [11] 헤더-아이템 금액 정합성 경고 ────────────────────────
-- expected: 0 rows. header.total_amount 와 items.amount 합이 맞지 않는 헤더.
SELECT
  '[11] header vs items mismatch'                   AS check_name,
  h.id                                               AS header_id,
  h.total_amount                                     AS header_total,
  COALESCE(SUM(i.amount), 0)                         AS items_sum,
  h.total_amount - COALESCE(SUM(i.amount), 0)        AS diff
FROM cross_store_settlements h
LEFT JOIN cross_store_settlement_items i
  ON i.cross_store_settlement_id = h.id
 AND i.deleted_at IS NULL
WHERE h.deleted_at IS NULL
GROUP BY h.id, h.total_amount
HAVING h.total_amount <> COALESCE(SUM(i.amount), 0)
ORDER BY ABS(h.total_amount - COALESCE(SUM(i.amount), 0)) DESC
LIMIT 50;
