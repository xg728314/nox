-- 110_chat_bot_infra.sql
--
-- R36 (2026-09-09): NOX 채팅 봇 인프라
-- 사용자 결정: 카톡 → NOX chat 이관 · 봇이 오탈자 공개 안내 (학습 효과)
--
-- 추가:
--   1. store_settings.chat_parser_strictness  — 매장 owner 가 봇 엄격도 조절
--         'friendly' (친절 · default) : 못 알아들으면 매번 안내
--         'standard'                  : 명확한 오류만 · 애매한 건 조용히
--         'strict'                    : 규칙 어긴 것만 짧게 지적
--         'silent'                    : 봇 완전 침묵
--
--   2. store_settings.chat_rules_json       — 매장별 규칙 (핀 배너)
--         { "prefix_required": true, "examples": [...], "shortcut_dict": {...} }
--
--   3. chat_bot_reply_log                    — 봇 답장 기록 (rate limit + audit)
--         · 같은 사용자 같은 오류 3회 후 침묵
--         · 피크시간 압축 모드 판단
--
--   4. chat_tutorial_seen                    — 신입 튜토리얼 상태
--         · 채팅방 첫 진입 시 개인 DM 봇 안내
--         · 한 번만 발송

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS chat_parser_strictness TEXT
    DEFAULT 'friendly'
    CHECK (chat_parser_strictness IN ('friendly', 'standard', 'strict', 'silent'));

COMMENT ON COLUMN store_settings.chat_parser_strictness IS
  'R36 봇 엄격도: friendly (매번 안내) / standard (명확한 오류만) / strict (규칙 위반만) / silent (침묵)';

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS chat_rules_json JSONB;

COMMENT ON COLUMN store_settings.chat_rules_json IS
  'R36 매장 규칙 (배너 · 튜토리얼용). null = default 사용';

-- 봇 답장 로그 · rate limit + audit
CREATE TABLE IF NOT EXISTS chat_bot_reply_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL,
  parent_message_id UUID,                     -- 봇이 답장한 원본 메시지
  target_membership_id UUID,                  -- 봇이 코칭한 사용자
  target_profile_id UUID,                     -- 학습용
  reply_pattern TEXT NOT NULL,                -- 'understand_confirm' | 'partial_missing' | 'template_suggest' | 'silence'
  error_signature TEXT,                       -- 오류 서명 (같은 사람 같은 오류 감지용) e.g. "missing_store_prefix"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,  -- 억제 (침묵) 여부
  suppress_reason TEXT                        -- 'user_repeated', 'peak_hour', 'strictness_silent' 등
);

CREATE INDEX IF NOT EXISTS idx_chat_bot_reply_log_target_error
  ON chat_bot_reply_log (target_membership_id, error_signature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_bot_reply_log_room
  ON chat_bot_reply_log (chat_room_id, created_at DESC);

COMMENT ON TABLE chat_bot_reply_log IS
  'R36 봇 답장 이력 · 같은 사용자 같은 오류 3회 후 침묵 판단용 + audit';

-- 신입 튜토리얼 상태
CREATE TABLE IF NOT EXISTS chat_tutorial_seen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL,
  store_uuid UUID NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membership_id, store_uuid)
);

CREATE INDEX IF NOT EXISTS idx_chat_tutorial_seen_membership
  ON chat_tutorial_seen (membership_id);

COMMENT ON TABLE chat_tutorial_seen IS
  'R36 채팅방 첫 진입 튜토리얼 봇 안내 발송 여부';
