-- 084_cross_store_fk_integrity.sql
-- 2026-04-24 P2 fix: cross_store_settlement_items 의 상위 참조 무결성 강화.
--
-- 2026-04-25 hotfix (2nd iteration): 실제 DB 스키마에 맞춰 컬럼 존재 여부를
--   information_schema 로 런타임 확인 후 FK 를 조건부 생성한다. 이전 버전은
--   `stores(store_uuid)` (잘못된 PK 경로) + `origin_store_uuid` (실제는
--   target_store_uuid) 로 인해 실패했다.
--
-- 참조 규칙 (migration 002/035 기반):
--   - stores 의 primary key 는 id (UUID)
--   - 다른 테이블들의 store_uuid / target_store_uuid / origin_store_uuid 등은
--     모두 stores(id) 를 참조한다
--
-- 어떤 컬럼은 존재할 수도 있고, 후행 migration 036/038 에서 이름이 바뀌었을
-- 수도 있다. 각 FK 를 독립적으로 존재 체크 후 생성.
--
-- ON DELETE RESTRICT — header hard delete 차단.
-- 멱등 — pg_constraint + information_schema 더블 체크.

BEGIN;

-- 1) orphan 체크 (있으면 중단)
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
  FROM cross_store_settlement_items csi
  LEFT JOIN cross_store_settlements cs ON cs.id = csi.cross_store_settlement_id
  WHERE cs.id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'cross_store_settlement_items 중 상위 header 가 없는 orphan %건. 정정 후 재실행.',
      bad_count;
  END IF;
END $$;

-- 2) FK: cross_store_settlement_id → cross_store_settlements(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_header_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_header_fk
      FOREIGN KEY (cross_store_settlement_id)
      REFERENCES cross_store_settlements(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 3) FK: store_uuid → stores(id) — 컬럼 존재 시만
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cross_store_settlement_items' AND column_name = 'store_uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_store_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_store_fk
      FOREIGN KEY (store_uuid)
      REFERENCES stores(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 4) FK: target_store_uuid → stores(id) — 컬럼 존재 시만
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cross_store_settlement_items' AND column_name = 'target_store_uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_target_store_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_target_store_fk
      FOREIGN KEY (target_store_uuid)
      REFERENCES stores(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 5) FK: origin_store_uuid → stores(id) — 후행 migration 에서 추가됐다면만
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cross_store_settlement_items' AND column_name = 'origin_store_uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cssi_origin_store_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_origin_store_fk
      FOREIGN KEY (origin_store_uuid)
      REFERENCES stores(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
