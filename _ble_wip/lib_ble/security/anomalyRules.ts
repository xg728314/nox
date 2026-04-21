/**
 * S-BLE-18A/18B: Rule-based Anomaly Detection
 * Detects operational failures using existing alert metrics and backend status
 * S-BLE-18B: Added pattern-based anomalies from alert event aggregation
 * Read-only evaluation - does not change suppression or threshold behavior
 */

import type { AlertMetrics } from "./alertMetrics";
import type { AnomalyEventStats } from "./anomalyEventStats";

export type AnomalyCode =
  | "BLE_ANOMALY_FAIL_OPEN_ACTIVE"
  | "BLE_ANOMALY_REDIS_UNSTABLE"
  | "BLE_ANOMALY_DB_SUPPRESSION_ERRORS"
  | "BLE_ANOMALY_HOT_AUTH_INVALID_IP"
  | "BLE_ANOMALY_GATEWAY_MISMATCH_HOTSPOT"
  | "BLE_ANOMALY_CLEANUP_FAILED_REPEATING";

export type AnomalySeverity = "critical" | "warning";

export interface AnomalyDetection {
  code: AnomalyCode;
  severity: AnomalySeverity;
  entity: string;
  message: string;
  detail: Record<string, unknown>;
  detected_at: string;
}

export interface BackendStatus {
  backend_mode: string;
  redis: {
    status: string;
    connected: boolean;
  };
  db: {
    status: string;
    connected: boolean;
  };
}

/**
 * Evaluate anomaly rules against current metrics and backend status
 * @param metrics - Current alert metrics snapshot
 * @param backendStatus - Current backend connection status
 * @param eventStats - Optional event stats from RPC (S-BLE-18B)
 * @returns Array of active anomaly detections
 */
export function evaluateAnomalyRules(
  metrics: AlertMetrics,
  backendStatus: BackendStatus,
  eventStats?: AnomalyEventStats
): AnomalyDetection[] {
  const detections: AnomalyDetection[] = [];
  const now = new Date().toISOString();

  // Rule 1: BLE_ANOMALY_FAIL_OPEN_ACTIVE
  // Trigger when fail_open > 0
  // Severity: critical
  if (metrics.fail_open > 0) {
    detections.push({
      code: "BLE_ANOMALY_FAIL_OPEN_ACTIVE",
      severity: "critical",
      entity: "global",
      message: `Alert suppression fail-open detected: ${metrics.fail_open} occurrence(s)`,
      detail: {
        fail_open_count: metrics.fail_open,
        backend_mode: backendStatus.backend_mode,
        redis_connected: backendStatus.redis.connected,
        db_connected: backendStatus.db.connected,
      },
      detected_at: now,
    });
  }

  // Rule 2: BLE_ANOMALY_REDIS_UNSTABLE
  // Trigger when redis_error >= 3
  // Severity: warning
  if (metrics.redis_error >= 3) {
    detections.push({
      code: "BLE_ANOMALY_REDIS_UNSTABLE",
      severity: "warning",
      entity: "global",
      message: `Redis operations unstable: ${metrics.redis_error} error(s) detected`,
      detail: {
        redis_error_count: metrics.redis_error,
        redis_status: backendStatus.redis.status,
        redis_connected: backendStatus.redis.connected,
        redis_hit: metrics.redis_hit,
        redis_miss: metrics.redis_miss,
      },
      detected_at: now,
    });
  }

  // Rule 3: BLE_ANOMALY_DB_SUPPRESSION_ERRORS
  // Trigger when db_error >= 1
  // Severity: critical
  if (metrics.db_error >= 1) {
    detections.push({
      code: "BLE_ANOMALY_DB_SUPPRESSION_ERRORS",
      severity: "critical",
      entity: "global",
      message: `Database suppression RPC errors: ${metrics.db_error} failure(s)`,
      detail: {
        db_error_count: metrics.db_error,
        db_status: backendStatus.db.status,
        db_connected: backendStatus.db.connected,
        db_allow: metrics.db_allow,
        db_suppress: metrics.db_suppress,
      },
      detected_at: now,
    });
  }

  // S-BLE-18B: Pattern-based anomalies from event stats
  if (eventStats && eventStats.stats.length > 0) {
    for (const stat of eventStats.stats) {
      // Rule 4: BLE_ANOMALY_HOT_AUTH_INVALID_IP
      // Trigger when BLE_SECURITY_AUTH_ATTACK events for an IP exceed threshold
      if (stat.alert_type === "BLE_SECURITY_AUTH_ATTACK" && stat.entity_type === "ip") {
        detections.push({
          code: "BLE_ANOMALY_HOT_AUTH_INVALID_IP",
          severity: "critical",
          entity: stat.entity_value,
          message: `Repeated auth attacks from IP ${stat.entity_value}: ${stat.event_count} events`,
          detail: {
            ip: stat.entity_value,
            event_count: stat.event_count,
            first_seen: stat.first_seen,
            last_seen: stat.last_seen,
            window: "24h",
          },
          detected_at: now,
        });
      }

      // Rule 5: BLE_ANOMALY_GATEWAY_MISMATCH_HOTSPOT
      // Trigger when BLE_SECURITY_GATEWAY_MISMATCH events for a gateway exceed threshold
      if (stat.alert_type === "BLE_SECURITY_GATEWAY_MISMATCH" && stat.entity_type === "gateway_id") {
        detections.push({
          code: "BLE_ANOMALY_GATEWAY_MISMATCH_HOTSPOT",
          severity: "warning",
          entity: stat.entity_value,
          message: `Gateway ID spoofing pattern detected for ${stat.entity_value}: ${stat.event_count} events`,
          detail: {
            gateway_id: stat.entity_value,
            event_count: stat.event_count,
            first_seen: stat.first_seen,
            last_seen: stat.last_seen,
            window: "24h",
          },
          detected_at: now,
        });
      }

      // Rule 6: BLE_ANOMALY_CLEANUP_FAILED_REPEATING
      // Trigger when BLE_SECURITY_CLEANUP_FAILED events for a room exceed threshold
      if (stat.alert_type === "BLE_SECURITY_CLEANUP_FAILED" && stat.entity_type === "room_id") {
        detections.push({
          code: "BLE_ANOMALY_CLEANUP_FAILED_REPEATING",
          severity: "warning",
          entity: stat.entity_value,
          message: `Repeating cleanup failures for ${stat.entity_value}: ${stat.event_count} events`,
          detail: {
            room_id: stat.entity_value,
            event_count: stat.event_count,
            first_seen: stat.first_seen,
            last_seen: stat.last_seen,
            window: "24h",
          },
          detected_at: now,
        });
      }
    }
  }

  return detections;
}

/**
 * Get severity display properties
 */
export function getAnomalySeverityStyle(severity: AnomalySeverity): {
  color: string;
  label: string;
} {
  switch (severity) {
    case "critical":
      return {
        color: "bg-red-500/20 text-red-400 border-red-500/30",
        label: "CRITICAL",
      };
    case "warning":
      return {
        color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
        label: "WARNING",
      };
    default:
      return {
        color: "bg-slate-500/20 text-slate-400 border-slate-500/30",
        label: "UNKNOWN",
      };
  }
}
