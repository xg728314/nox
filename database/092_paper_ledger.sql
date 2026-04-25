-- 092_paper_ledger.sql
-- R27 (2026-04-25): 종이 장부 사진 ↔ NOX 온라인 장부 대조 시스템.
--
-- 목적: 사장/실장이 매일 마감 후 종이장부 사진 1~2장 업로드 → 시스템이
--   Claude Vision 으로 추출 → DB 의 그날 데이터와 자동 비교 → 정확/불일치
--   를 즉시 가시화. NOX 가 정확하다는 증거 누적.
--
-- 설계 원칙:
--   - 사진 자체는 Supabase Storage (bucket: paper-ledgers).
--   - 추출 JSON 은 별도 row 로 분리 (재추출 가능).
--   - diff 결과도 별도 row (재계산 가능, 수동 노트 추가 가능).
--   - 매장별 종이 양식이 다름 → store_paper_format 으로 symbol_dictionary
--     누적 학습.
--   - hard delete 없음 (분쟁 증빙 + 회계 보관).

-- ─── 1. 사진 메타 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_ledger_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid      uuid NOT NULL REFERENCES stores(id),
  business_day_id uuid REFERENCES store_operating_days(id),  -- nullable: 업로드 시점에 못 추론할 수도
  business_date   date,                                       -- 사용자가 지정한 종이장부 날짜
  sheet_kind      text NOT NULL CHECK (sheet_kind IN ('rooms', 'staff', 'other')),
  storage_path    text NOT NULL,                              -- Supabase Storage 경로
  file_name       text,
  mime_type       text,
  size_bytes      int,
  status          text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracting', 'extracted', 'extract_failed', 'reviewed')),
  uploaded_by     uuid NOT NULL REFERENCES profiles(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES profiles(id),
  reviewed_at     timestamptz,
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_snapshots_store_date
  ON paper_ledger_snapshots (store_uuid, business_date DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_paper_snapshots_status
  ON paper_ledger_snapshots (status, uploaded_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON TABLE paper_ledger_snapshots IS
  'R27: 종이 장부 사진 메타. 실제 사진은 Storage bucket=paper-ledgers.';

-- ─── 2. VLM 추출 결과 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_ledger_extractions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES paper_ledger_snapshots(id) ON DELETE CASCADE,
  extracted_json  jsonb NOT NULL,
  vlm_model       text NOT NULL,             -- 'claude-sonnet-4-5' 등 — 모델 변경 추적
  prompt_version  int NOT NULL DEFAULT 1,    -- prompt 변경 시 +1
  cost_usd        numeric(10, 6),
  duration_ms     int,
  unknown_tokens  text[],                    -- VLM 이 분류 못한 심볼들 (사람 확인용)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_extract_snapshot
  ON paper_ledger_extractions (snapshot_id, created_at DESC);

-- ─── 3. DB ↔ 종이 비교 결과 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_ledger_diffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES paper_ledger_snapshots(id) ON DELETE CASCADE,
  extraction_id   uuid REFERENCES paper_ledger_extractions(id) ON DELETE SET NULL,
  -- 합계 닻 (anchor) 비교: 우측 박스의 줄돈/받돈
  paper_owe_total_won      bigint,
  paper_recv_total_won     bigint,
  db_owe_total_won         bigint,
  db_recv_total_won        bigint,
  -- 항목별 diff (각 매장 단위)
  item_diffs               jsonb,            -- [{ store, paper, db, diff_won, status }]
  -- 종합 평가
  match_status             text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'match', 'partial', 'mismatch', 'no_db_data')),
  manual_overrides         jsonb,            -- 실장이 수정한 라벨 (snapshot 단위)
  reviewer_notes           text,
  computed_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_diff_snapshot
  ON paper_ledger_diffs (snapshot_id, computed_at DESC);

-- ─── 4. 매장별 종이 포맷 학습 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS store_paper_format (
  store_uuid          uuid PRIMARY KEY REFERENCES stores(id),
  format_version      int NOT NULL DEFAULT 1,
  symbol_dictionary   jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* 예시:
     {
       "★":     { "service_type": "셔츠" },
       "빵3":   { "time_tier": "반차3" },
       "(완)":  { "time_tier": "완티" },
       "잔":    { "time_tier": "unknown", "needs_review": true }
     }
  */
  known_stores        text[] NOT NULL DEFAULT '{}',  -- 화이트리스트 (협력 매장명)
  notes               text,
  updated_by          uuid REFERENCES profiles(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE store_paper_format IS
  'R27: 매장별 종이장부 포맷 학습. 알 수 없는 심볼이 사람 확인 후 dictionary 에 누적.';

-- ─── 5. RLS ───────────────────────────────────────────────────
-- 모든 paper_* 테이블은 service-role 만 접근. app 은 resolveAuthContext 로
--   매장 스코프 후 service-role 클라이언트로 쿼리.
ALTER TABLE paper_ledger_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_ledger_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_ledger_diffs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_paper_format       ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_snap_service_only') THEN
    CREATE POLICY paper_snap_service_only ON paper_ledger_snapshots FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_extr_service_only') THEN
    CREATE POLICY paper_extr_service_only ON paper_ledger_extractions FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_diff_service_only') THEN
    CREATE POLICY paper_diff_service_only ON paper_ledger_diffs FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_fmt_service_only') THEN
    CREATE POLICY paper_fmt_service_only ON store_paper_format FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ─── 6. Storage bucket — 수동 생성 안내 ───────────────────────
-- Supabase Dashboard → Storage → Create bucket:
--   name: paper-ledgers
--   public: false
--   File size limit: 10 MB
--   Allowed MIME types: image/jpeg, image/png, image/heic, image/webp
-- (SQL 로 자동 생성 가능하나 정책 디테일 차이로 Dashboard 권장)
