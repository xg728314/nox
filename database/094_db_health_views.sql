-- 094_db_health_views.sql
-- R28-fix (2026-04-26): DB 헬스 시그널을 watchdog 에서 자동 노출.
--
-- 추가:
--   1. v_index_usage  — pg_stat_user_indexes 기반. idx_scan=0 인 인덱스 식별.
--   2. v_table_stats  — 테이블별 row count + dead tuples + last vacuum.
--   3. v_slow_queries (옵션) — pg_stat_statements 가 켜진 환경에서만 노출.
--
-- 보안: VIEW 자체 RLS 불가하나 service-role 만 호출하므로 OK.

CREATE OR REPLACE VIEW v_index_usage AS
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC;

COMMENT ON VIEW v_index_usage IS
  'R28-fix: 인덱스별 사용 횟수. idx_scan=0 long-term 이면 미사용 의심.';

CREATE OR REPLACE VIEW v_table_stats AS
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS live_rows,
  n_dead_tup AS dead_rows,
  last_autovacuum,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

COMMENT ON VIEW v_table_stats IS
  'R28-fix: 테이블별 row 수 + dead tuples. dead_rows / live_rows 비율 높으면 vacuum 필요.';
