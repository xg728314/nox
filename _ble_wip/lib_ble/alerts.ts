
import { bleMetrics } from "./metrics";
import { type ActiveSession } from "@/lib/counterStore";

export type AlertType =
    | "GATEWAY_OFFLINE"
    | "HIGH_DEDUPE_RATE"
    | "INVALID_EVENT_SPIKE"
    | "STUCK_SESSION"
    | "ALERT_LEAVE";

export interface SystemAlert {
    id: string; // unique key
    type: AlertType;
    message: string;
    level: "warning" | "critical";
    timestamp: number;
    /** Set when normalized from alerts table (room_no); used for room warning map */
    room_no?: number;
}

export const ALERT_THRESHOLDS = {
    GATEWAY_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes without signal
    DEDUPE_DROP_RATE_MAX: 10,          // > 10 drops per poll interval (approx, simplified)
    INVALID_EVENT_MAX: 5,              // > 5 invalid events
    STUCK_SESSION_HOURS: 12            // Session longer than 12h without checkout
};

// Helper: Check Gateway Health
export function checkGatewayAlerts(
    gateways: Map<string, { lastSeen: number }>
): SystemAlert[] {
    const alerts: SystemAlert[] = [];
    const now = Date.now();

    gateways.forEach((gw, deviceId) => {
        if (now - gw.lastSeen > ALERT_THRESHOLDS.GATEWAY_TIMEOUT_MS) {
            alerts.push({
                id: `gw-offline-${deviceId}`,
                type: "GATEWAY_OFFLINE",
                message: `Gateway ${deviceId} silent for > 5 mins`,
                level: "critical",
                timestamp: now
            });
        }
    });

    return alerts;
}

// Helper: Check Metrics Spikes
// Note: This matches current accumulated metrics vs previous snapshot. 
// Caller must track previous snapshot.
export function checkMetricAlerts(
    current: typeof bleMetrics,
    previous: typeof bleMetrics
): SystemAlert[] {
    const alerts: SystemAlert[] = [];
    const now = Date.now();

    const dedupDelta = current.eventsDroppedDedupe - previous.eventsDroppedDedupe;
    if (dedupDelta > ALERT_THRESHOLDS.DEDUPE_DROP_RATE_MAX) {
        alerts.push({
            id: `spike-dedupe-${now}`,
            type: "HIGH_DEDUPE_RATE",
            message: `High dedupe rate: ${dedupDelta} events dropped recently`,
            level: "warning",
            timestamp: now
        });
    }

    const invalidDelta = current.eventsInvalid - previous.eventsInvalid;
    if (invalidDelta > ALERT_THRESHOLDS.INVALID_EVENT_MAX) {
        alerts.push({
            id: `spike-invalid-${now}`,
            type: "INVALID_EVENT_SPIKE",
            message: `Invalid event spike: ${invalidDelta} ignored`,
            level: "warning",
            timestamp: now
        });
    }

    return alerts;
}

// Helper: Check Stuck Sessions
export function checkSessionAlerts(sessions: ActiveSession[]): SystemAlert[] {
    const alerts: SystemAlert[] = [];
    const now = Date.now();
    const MAX_DURATION_MS = ALERT_THRESHOLDS.STUCK_SESSION_HOURS * 60 * 60 * 1000;

    sessions.forEach(s => {
        const start = new Date(s.startedAt ?? 0).getTime();
        if (now - start > MAX_DURATION_MS) {
            alerts.push({
                id: `stuck-${s.id}`,
                type: "STUCK_SESSION",
                message: `Room ${s.roomId} active for > ${ALERT_THRESHOLDS.STUCK_SESSION_HOURS}h`,
                level: "warning",
                timestamp: now
            });
        }
    });

    return alerts;
}

