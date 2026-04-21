-- 025: credits.linked_account_id — structured credit ↔ account linkage
--
-- Replaces the STEP-007 temporary memo-tag based linkage (`[수금계좌] …`) with
-- a proper foreign-key column. The existing `credits.status` +
-- `credits.collected_at` + `credits.collected_by` columns already cover the
-- settlement status + timestamp, so no new status/timestamp columns are added.
--
-- FK target: membership_bank_accounts (created in 024).
-- Nullable because:
--   - legacy rows predate the link
--   - cancelled credits have no account
--   - future auto-collect flows may fill the account later
--
-- No backfill. Existing `pending` rows stay with `linked_account_id IS NULL`.

ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS linked_account_id UUID
  REFERENCES membership_bank_accounts(id);

-- Read pattern: "which credits settled into this account" / "account of this credit"
CREATE INDEX IF NOT EXISTS idx_credits_linked_account
  ON credits(linked_account_id)
  WHERE linked_account_id IS NOT NULL;
