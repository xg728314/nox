-- 105_learning_signals.sql
-- R-Learn-Corpus (2026-04-30): "모든 데이터 학습, 적용 안 함" 정책의 데이터 인프라.
--
-- 운영자 의도:
--   "사람이 수정한 것은 모두 학습 데이터로 누적해라. 단 자동 적용은
--    하지 마라. 향후 어플 / 모델 fine-tune 시 reference 로 사용."
--
-- 설계:
--   - 모든 NOX 영역 (reconcile / counter / settlement / inventory / ...)
--     에서 사용자가 raw → corrected 수정 발생 시 row 1개 insert.
--   - 적용 정책: APPLY 안 함. dictionary / known_stores 같은 runtime
--     반영은 별도 (paper_format) 테이블이 담당. 본 테이블은 corpus.
--   - 운영자가 export (CSV, JSON) 해서 외부 모델 학습에 사용 가능.
--
-- PII 보호:
--   - raw_value / corrected_value 가 hostess 이름 등 PII 가능 → masking
--     함수 helper 가 application 레이어에서 처리 (lib/learn/captureSignal).
--   - 본 테이블은 raw bytes 보관하되 RLS service-only 로 일반 user 차단.
--   - 30일 이상 된 row 자동 archive 옵션 (별도 cron).
--
-- 인덱스:
--   - (store_uuid, signal_type, created_at DESC) — 매장별 최신 학습
--   - (signal_type, created_at DESC) — 전사 시그널 분포
--
-- Migration:
--   CREATE TABLE IF NOT EXISTS — 재실행 안전.

CREATE TABLE IF NOT EXISTS learning_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid      uuid REFERENCES stores(id),
  user_id         uuid REFERENCES profiles(id),
  /* 시그널 타입 — application 레이어가 set. 자유 형식. 예:
     'reconcile.staff.hostess_name'
     'reconcile.staff.session.store'
     'reconcile.rooms.staff.origin_store'
     'counter.session.manager_change'
     'inventory.item.unit_price'
     'settlement.amount.override'
     ... */
  signal_type     text NOT NULL,
  /* 원본값 (AI 추출 또는 시스템 자동 계산). NULL 가능 (수동 추가 케이스). */
  raw_value       text,
  /* 사람이 수정한 값. 정상 학습 신호. */
  corrected_value text,
  /* PII 마스킹 여부. 마스킹된 row 는 분석 시 raw_value/corrected_value 가
     hash 또는 redacted 텍스트. */
  pii_masked      boolean NOT NULL DEFAULT false,
  /* 추가 컨텍스트 (snapshot_id, session_id, 매장명 등). 자유 jsonb. */
  context         jsonb DEFAULT '{}'::jsonb,
  /* 모델 추적: VLM / LLM 호출 결과인 경우 model + prompt_version. */
  source_model    text,
  source_prompt_version int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  /* 학습 데이터 archive (30일 이상 등 운영 정책 별 cron 처리). */
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_learning_signals_store_type_time
  ON learning_signals (store_uuid, signal_type, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_learning_signals_type_time
  ON learning_signals (signal_type, created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE learning_signals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'learning_signals_service_only') THEN
    CREATE POLICY learning_signals_service_only ON learning_signals
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE learning_signals IS
  'R-Learn-Corpus: 사람이 수정한 raw→corrected 쌍. 적용 안 함, 누적만. 향후 모델 학습용 corpus.';
COMMENT ON COLUMN learning_signals.signal_type IS
  '예: reconcile.staff.hostess_name / counter.session.manager_change.';
COMMENT ON COLUMN learning_signals.pii_masked IS
  'true 면 raw_value/corrected_value 가 hash 또는 redacted (이름/전화 등).';
