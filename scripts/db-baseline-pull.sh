#!/usr/bin/env bash
# ============================================================
# NOX DB baseline 공식 추출 스크립트
# ============================================================
# 목적: 현재 live Supabase DB 의 완전한 스키마를 단일 SQL 파일로 추출.
#       신규 환경 재생성 시 정식 소스로 사용.
#
# 전제: supabase CLI 설치됨 (`npm install -g supabase`).
# ============================================================
set -euo pipefail

# ─── 설정 ───────────────────────────────────────────
: "${SUPABASE_DB_URL:?env SUPABASE_DB_URL 필요. 예: postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres}"

OUT_DIR="database/_baseline_$(date +%Y-%m-%d)"
mkdir -p "$OUT_DIR"

echo "[1/3] supabase db pull — public + auth 스키마"
supabase db pull \
  --db-url "$SUPABASE_DB_URL" \
  --schema public,auth \
  --file "$OUT_DIR/schema_pull.sql"

echo "[2/3] RPC 전체 본문 덤프"
psql "$SUPABASE_DB_URL" -At -c "
  SELECT E'\n-- ============================================================\n-- ' || p.proname || E'\n-- ============================================================\n' || pg_get_functiondef(p.oid) || E';\n'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
  ORDER BY p.proname;
" > "$OUT_DIR/functions_full.sql"

echo "[3/3] RLS 정책 상세"
psql "$SUPABASE_DB_URL" -At -c "
  SELECT format(E'CREATE POLICY %I ON public.%I FOR %s TO %s USING (%s)%s;\n',
    policyname, tablename, cmd, array_to_string(roles, ', '),
    COALESCE(qual, 'true'),
    CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END)
  FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
" > "$OUT_DIR/rls_full.sql"

echo "[완료] $OUT_DIR 에 파일 3개 생성:"
ls -la "$OUT_DIR"

cat <<MSG

다음 단계:
  신규 환경 재생성:
    supabase db push --db-url <new-url> --include-all
    또는
    psql <new-url> -f $OUT_DIR/schema_pull.sql
    psql <new-url> -f $OUT_DIR/functions_full.sql
    psql <new-url> -f $OUT_DIR/rls_full.sql

MSG
