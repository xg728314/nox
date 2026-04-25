-- 090_cron_heartbeats.sql
-- R24 (2026-04-25): Cron 사일런트 실패 감지.
--
-- 문제: Vercel cron 4개 등록되어 있는데 "마지막 실행 시각" 추적이 없음.
--   cron 자체가 멈춰도 watchdog 은 "이상 없음" 으로 보임 → 모니터가 꺼진 줄
--   모르는 상태가 가장 위험.
--
-- 해결: 각 cron 시작/종료 시 cron_name 으로 heartbeat row 1개를 upsert.
--   watchdog 이 (now() - last_run_at) 가 임계치 초과인 cron 을 stale 로 분류.
--
-- 임계치 (lib/automation/cronHeartbeat.ts 와 동기화):
--   ops-alerts-scan       */5 * * * *   → stale > 15분 (3회 연속 누락)
--   ble-attendance-sync   */2 * * * *   → stale > 10분
--   ble-session-inference */2 * * * *   → stale > 10분
--   ble-history-reaper    0 3 * * *     → stale > 26시간

CREATE TABLE IF NOT EXISTS cron_heartbeats (
  cron_name        text PRIMARY KEY,
  last_run_at      timestamptz NOT NULL,
  last_success_at  timestamptz,
  last_error       text,
  run_count_total  bigint NOT NULL DEFAULT 0,
  run_count_failed bigint NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cron_heartbeats IS
  'R24 (2026-04-25): Vercel cron 실행 흔적. 각 cron 라우트가 시작/종료 시 stamp.';
COMMENT ON COLUMN cron_heartbeats.last_run_at IS
  '마지막 실행 시작 시각 (성공/실패 무관). watchdog stale 판정 기준.';
COMMENT ON COLUMN cron_heartbeats.last_success_at IS
  '마지막 성공 시각. last_run_at 보다 오래되었으면 = 최근 실행 실패.';

-- service-role 만 접근. RLS 활성화 (다른 cron 흔적 모방 방지).
ALTER TABLE cron_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cron_heartbeats_service_only ON cron_heartbeats;
CREATE POLICY cron_heartbeats_service_only ON cron_heartbeats
  FOR ALL
  TO public
  USING (false)        -- 일반 user JWT 차단
  WITH CHECK (false);  -- 쓰기도 차단 (service-role 은 RLS 우회)
