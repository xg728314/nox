-- 099_paper_ledger_edits.sql
-- R-B (2026-04-28): 종이장부 사람-편집 결과 보관.
--
-- 디자인:
--   - extraction (VLM 출력) 과 edit (사람 출력) 분리.
--     extraction = paper_ledger_extractions (불변 원본)
--     edit       = paper_ledger_edits      (사람이 검수+수정한 결과)
--   - 다중 편집 이력 가능 (snapshot_id + edited_at).
--   - diff 가 어느 source 를 비교했는지 추적 (paper_ledger_diffs.source_edit_id).
--   - hard delete 없음.
--
-- 적용 (R-C 미래 라운드):
--   - 사람이 검수 완료한 edit 을 NOX 운영 데이터 (room_sessions / orders 등) 에
--     반영하는 'apply' 단계는 별도 라운드. 이 마이그레이션은 검수+저장만.

-- 1. snapshot status 에 'edited' 추가
ALTER TABLE paper_ledger_snapshots DROP CONSTRAINT IF EXISTS paper_ledger_snapshots_status_check;
ALTER TABLE paper_ledger_snapshots ADD CONSTRAINT paper_ledger_snapshots_status_check
  CHECK (status IN ('uploaded','extracting','extracted','extract_failed','edited','reviewed'));

-- 2. edits 테이블
CREATE TABLE IF NOT EXISTS paper_ledger_edits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES paper_ledger_snapshots(id) ON DELETE CASCADE,
  /* 편집 시작점 — 어떤 extraction row 를 base 로 편집했는지 (감사 추적). */
  base_extraction_id uuid REFERENCES paper_ledger_extractions(id) ON DELETE SET NULL,
  edited_json     jsonb NOT NULL,
  /* 변경 요약 메타. UI 표시용 + audit (예: {"rooms_changed":2,"staff_changed":5}). */
  edit_summary    jsonb,
  edit_reason     text,
  edited_by       uuid NOT NULL REFERENCES profiles(id),
  edited_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_edits_snapshot
  ON paper_ledger_edits (snapshot_id, edited_at DESC);

-- 3. diff 가 어느 edit 을 source 로 썼는지 추적 (nullable — 기존 row 호환)
ALTER TABLE paper_ledger_diffs
  ADD COLUMN IF NOT EXISTS source_edit_id uuid REFERENCES paper_ledger_edits(id) ON DELETE SET NULL;

-- 4. RLS — service-role 만
ALTER TABLE paper_ledger_edits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_edit_service_only') THEN
    CREATE POLICY paper_edit_service_only ON paper_ledger_edits
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE paper_ledger_edits IS
  'R-B: 종이장부 사람-편집 결과. AI 추출 (paper_ledger_extractions) 과 분리 보관. R-C 에서 NOX 운영 데이터로 apply.';
