-- ============================================================
-- 111. hostess_pre_registrations
-- ============================================================
-- 2026-06-08 R-스태프-사전등록:
--   실장이 본인 매장에 새 스태프(아가씨)를 "이름 + 전화" 만으로 사전 등록.
--   아직 NOX 계정이 없는 사람을 미리 명단에 올려두고, 본인이 나중에
--   /signup 으로 가입할 때 전화번호 매칭으로 자동 연동.
--
-- 기존 hostesses 테이블은 membership_id NOT NULL 이라 인증된 user 없이는
-- row 생성 불가. 그래서 별도 테이블로 "가입 대기" 상태를 추적.
--
-- 흐름
--   1. 실장이 /m/staff/new 사전등록 탭에서 이름+전화 입력
--      → INSERT INTO hostess_pre_registrations (manager_membership_id, name, phone)
--   2. /api/manager/hostesses 가 hostesses + pre_registrations 둘 다 반환
--      (pre_reg 는 is_pending=true 플래그로 구분)
--   3. 그 사람이 /signup 으로 가입 (전화 X 로 회원가입)
--      → /api/auth/signup 후처리에서 hostess_pre_registrations 에 같은 phone
--         있는지 검사 → 매칭 시 linked_membership_id 채움 + 실제 hostesses
--         row 도 동일 시점에 생성
-- ============================================================

CREATE TABLE IF NOT EXISTS hostess_pre_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_uuid UUID NOT NULL REFERENCES stores(id),
  manager_membership_id UUID NOT NULL REFERENCES store_memberships(id),
  -- 표시용 이름 (필수)
  name TEXT NOT NULL,
  -- 매칭 키 — 숫자만 저장 (010-1234-5678 → 01012345678)
  phone TEXT NOT NULL,
  -- 매니저가 옵션으로 메모를 남길 수 있게 (활동명, 메모 등)
  stage_name TEXT,
  note TEXT,

  -- 가입 완료 시 채워짐 (실제 store_memberships.id)
  linked_membership_id UUID REFERENCES store_memberships(id),
  linked_at TIMESTAMPTZ,
  -- 가입 완료 시 채워짐 (실제 hostesses.id)
  linked_hostess_id UUID REFERENCES hostesses(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 실장이 취소했거나 매칭 후 정리
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE hostess_pre_registrations IS
  '실장이 가입 전 스태프를 이름+전화로 사전등록. /signup 후 전화 매칭으로 자동연동.';

-- 매장 별 active 사전등록 빠른 조회
CREATE INDEX IF NOT EXISTS idx_hostess_pre_reg_store
  ON hostess_pre_registrations(store_uuid)
  WHERE deleted_at IS NULL;

-- 실장 별 본인 사전등록 빠른 조회 (모바일 staff 목록)
CREATE INDEX IF NOT EXISTS idx_hostess_pre_reg_manager
  ON hostess_pre_registrations(manager_membership_id)
  WHERE deleted_at IS NULL;

-- /signup 시 전화 매칭 — linked 안 된 것만 검색
CREATE INDEX IF NOT EXISTS idx_hostess_pre_reg_phone_unlinked
  ON hostess_pre_registrations(phone)
  WHERE deleted_at IS NULL AND linked_membership_id IS NULL;

-- updated_at trigger (다른 테이블과 일관성)
CREATE OR REPLACE FUNCTION set_updated_at_hostess_pre_reg()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hostess_pre_reg_updated_at ON hostess_pre_registrations;
CREATE TRIGGER trg_hostess_pre_reg_updated_at
  BEFORE UPDATE ON hostess_pre_registrations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_hostess_pre_reg();

-- RLS 활성화. 정책은 service-role 우회 기준이라 앱 route 동작 무관.
ALTER TABLE hostess_pre_registrations ENABLE ROW LEVEL SECURITY;

-- 매장 멤버는 자기 매장 사전등록 조회 가능 (선택적, 앱은 service-role 사용)
-- 재실행 안전성을 위해 DROP IF EXISTS 후 CREATE.
DROP POLICY IF EXISTS hostess_pre_reg_select_same_store ON hostess_pre_registrations;
CREATE POLICY hostess_pre_reg_select_same_store
  ON hostess_pre_registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM store_memberships
      WHERE store_memberships.profile_id = auth.uid()
        AND store_memberships.store_uuid = hostess_pre_registrations.store_uuid
        AND store_memberships.status = 'approved'
        AND store_memberships.deleted_at IS NULL
    )
  );
