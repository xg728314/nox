-- 119: staff_payout_states — 영업일 단위 식구 정산 상태
--
-- 한 식구가 하루에 일한 모든 세션의 합계 (gross/hostess_payout) 와 별개로,
-- 실장이 식구에게 줘야 할 돈을 어떻게 처리했는지 트래킹.
--
-- 상태 3종:
--   'pending'  : 아직 정산 안 함
--   'paid'     : 정산 완료 (현금/계좌로 지급)
--   'held'     : 매장에 보관 (식구가 나중에 받아감)
--
-- 팁: 매출과 별개로 손님이 식구에게 직접 준 팁. 정산 시 더해서 지급.
-- 팁도 즉시 줄 수도 / 매장에 보관할 수도 있음 → tip_amount + tip_held_amount 분리.

CREATE TABLE IF NOT EXISTS staff_payout_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid UUID NOT NULL REFERENCES stores(id),
  business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
  hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'held')),

  -- 정산 금액 — 일 결산 시 client/server 가 계산해서 저장 (snapshot)
  base_amount INTEGER NOT NULL DEFAULT 0,  -- session_participants 합계 (참고용)

  -- 팁
  tip_amount INTEGER NOT NULL DEFAULT 0
    CHECK (tip_amount >= 0),
  tip_held_amount INTEGER NOT NULL DEFAULT 0
    CHECK (tip_held_amount >= 0),  -- 보관 중인 팁 (지급 안 함)

  -- 보관 금액 (정산금 자체를 보관)
  held_amount INTEGER NOT NULL DEFAULT 0
    CHECK (held_amount >= 0),

  -- 실 지급
  paid_amount INTEGER NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES auth.users(id),
  paid_method TEXT CHECK (paid_method IN ('cash', 'account')),

  memo TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

-- 영업일 + 식구 = unique (식구 1명당 1 row per 영업일)
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_payout_states_day_hostess
  ON staff_payout_states (store_uuid, business_day_id, hostess_membership_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_payout_states_day
  ON staff_payout_states (store_uuid, business_day_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE staff_payout_states IS '식구별 영업일 정산 상태 — 정산완료/보관/팁 트래킹';
COMMENT ON COLUMN staff_payout_states.status IS 'pending(미지급) / paid(지급완료) / held(매장 보관)';
COMMENT ON COLUMN staff_payout_states.tip_amount IS '오늘 받은 팁 (지급 예정)';
COMMENT ON COLUMN staff_payout_states.tip_held_amount IS '보관 중인 팁 (나중 지급)';
COMMENT ON COLUMN staff_payout_states.held_amount IS '보관 중인 정산금 (식구 요청)';
