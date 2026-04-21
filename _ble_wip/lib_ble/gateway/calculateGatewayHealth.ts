/**
 * S-BLE-12: Gateway Health Status Calculator
 * Read-only health assessment - no automation/control
 */

export type GatewayHealthStatus =
  | "healthy"
  | "delayed"
  | "offline_candidate"
  | "security_attention";

export type GatewayHealthInput = {
  last_heartbeat_at: string | null;
  last_ingest_at: string | null;
  recent_security_issues: number;
  recent_rate_limited: number;
};

export type GatewayHealthResult = {
  health_status: GatewayHealthStatus;
  heartbeat_age_sec: number | null;
  ingest_age_sec: number | null;
  operator_hint: string;
};

const HEARTBEAT_HEALTHY_SEC = 120; // 2분
const INGEST_HEALTHY_SEC = 300; // 5분
const OFFLINE_THRESHOLD_SEC = 600; // 10분
const SECURITY_ISSUE_THRESHOLD = 3;

function getAgeSec(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) return null;
  const ms = Date.parse(isoTimestamp);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

export function calculateGatewayHealth(input: GatewayHealthInput): GatewayHealthResult {
  const heartbeatAge = getAgeSec(input.last_heartbeat_at);
  const ingestAge = getAgeSec(input.last_ingest_at);

  // Priority 1: Security attention
  if (input.recent_security_issues >= SECURITY_ISSUE_THRESHOLD || input.recent_rate_limited >= SECURITY_ISSUE_THRESHOLD) {
    return {
      health_status: "security_attention",
      heartbeat_age_sec: heartbeatAge,
      ingest_age_sec: ingestAge,
      operator_hint: "인증 실패 / rate burst 확인 - 설정 오류 여부 점검",
    };
  }

  // Priority 2: Offline candidate
  const heartbeatOffline = heartbeatAge == null || heartbeatAge > OFFLINE_THRESHOLD_SEC;
  const ingestOffline = ingestAge == null || ingestAge > OFFLINE_THRESHOLD_SEC;
  if (heartbeatOffline && ingestOffline) {
    return {
      health_status: "offline_candidate",
      heartbeat_age_sec: heartbeatAge,
      ingest_age_sec: ingestAge,
      operator_hint: "전원 / PoE / 공유기 확인 - 물리 상태 점검",
    };
  }

  // Priority 3: Delayed
  const heartbeatDelayed = heartbeatAge != null && heartbeatAge > HEARTBEAT_HEALTHY_SEC;
  const ingestDelayed = ingestAge != null && ingestAge > INGEST_HEALTHY_SEC;
  if (heartbeatDelayed || ingestDelayed) {
    return {
      health_status: "delayed",
      heartbeat_age_sec: heartbeatAge,
      ingest_age_sec: ingestAge,
      operator_hint: "네트워크 또는 전송 지연 확인 - 펌웨어 상태 점검",
    };
  }

  // Priority 4: Healthy
  return {
    health_status: "healthy",
    heartbeat_age_sec: heartbeatAge,
    ingest_age_sec: ingestAge,
    operator_hint: "정상 동작",
  };
}
