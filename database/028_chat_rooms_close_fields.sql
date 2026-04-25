-- ⚠️ APPLIED AS: chat_rooms_close_fields
-- 로컬 028, Supabase history 는 번호 없는 이름.
--
-- 028: chat_rooms soft-close fields (STEP-009.1)
--
-- Adds structured close metadata so room_session chat can be soft-closed on
-- session checkout. chat_rooms already has `is_active BOOLEAN DEFAULT true`,
-- which is the functional flag; this migration adds `closed_at` and
-- `closed_reason` to carry the reason + timestamp of the transition.
--
-- Scope: ADD COLUMN only. No data backfill. No index change. Existing
-- chat rooms stay is_active=true / closed_at=NULL / closed_reason=NULL.
--
-- closed_reason taxonomy (documented here, enforced in application layer):
--   'checkout' — session checkout flow fired auto-close
--   'manual'   — operator-initiated close (future)
--   'system'   — background cleanup (future)

ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS closed_reason TEXT;
