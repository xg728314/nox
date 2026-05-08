-- 110_store_display_labels.sql
--
-- Per-store label customization.
--
-- 매장별로 점주가 본인이 익숙한 단어를 자유롭게 입력 가능.
-- 예: A 매장 = 실장/퍼블릭, B 매장 = 매니저/Type A, C 매장 = 사장님/풀세트
--
-- DB 의 service_type 컬럼 (퍼블릭/셔츠/하퍼) 은 영구 키로 보존.
-- display_labels 는 UI 표시용 매핑만.
--
-- 형태:
--   {
--     "manager": "실장",
--     "staff": "직원",
--     "customer": "손님",
--     "service_p": "퍼블릭",
--     "service_s": "셔츠",
--     "service_h": "하퍼",
--     ...
--   }
--
-- 미설정 매장: display_labels = '{}' → 빌드 모드 default 사용.
--   - web 빌드: 기존 industry 라벨 (실장/퍼블릭/셔츠/하퍼)
--   - app 빌드: generic 라벨 (매니저/P 이용권/...)

-- 1. display_labels 컬럼 추가 (이미 있으면 skip).
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS display_labels JSONB DEFAULT '{}'::jsonb;

-- 2. 인덱스 — display_labels 는 매장 settings 조회 시 단일 row 만 반환되므로
--    별도 인덱스 불필요 (store_uuid 단일 인덱스 충분).

-- 3. NULL 방지 — DEFAULT 가 있지만 기존 row 의 NULL 도 빈 객체로 정규화.
UPDATE store_settings
SET display_labels = '{}'::jsonb
WHERE display_labels IS NULL;

-- 4. NOT NULL 제약 추가 (이후 row 항상 객체 보장).
ALTER TABLE store_settings
  ALTER COLUMN display_labels SET NOT NULL;

-- 5. CHECK 제약 — JSONB 가 객체여야 함 (배열/스칼라 거부).
ALTER TABLE store_settings
  DROP CONSTRAINT IF EXISTS store_settings_display_labels_object;
ALTER TABLE store_settings
  ADD CONSTRAINT store_settings_display_labels_object
  CHECK (jsonb_typeof(display_labels) = 'object');

-- 검증: 매장별 라벨 조회 예시
-- SELECT store_uuid, display_labels FROM store_settings WHERE display_labels != '{}';

COMMENT ON COLUMN store_settings.display_labels IS
'매장별 UI 라벨 customization. 키는 lib/labels/default.ts 의 LabelKey, 값은 점주가 입력한 표시명. 빈 객체일 시 빌드 모드 default 사용.';
