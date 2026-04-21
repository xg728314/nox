-- 016: Add receipt_type to receipt_snapshots for interim/final distinction
-- Also add room_label for human-readable snapshot

ALTER TABLE receipt_snapshots
  ADD COLUMN IF NOT EXISTS receipt_type TEXT NOT NULL DEFAULT 'final';

-- Allowed values: 'interim' (mid-session bill), 'final' (checkout receipt)
COMMENT ON COLUMN receipt_snapshots.receipt_type IS 'interim = mid-session bill, final = checkout receipt';

CREATE INDEX IF NOT EXISTS idx_receipt_snapshots_session_type
  ON receipt_snapshots (session_id, receipt_type);
