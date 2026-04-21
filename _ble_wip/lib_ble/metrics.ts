// Simple in-memory metrics for BLE observability
// Reset on page reload

export const bleMetrics = {
  eventsReceived: 0,
  eventsDroppedDedupe: 0,
  eventsInvalid: 0,
  eventsProcessed: 0,
  autoEnters: 0,
  autoExits: 0,
  /** Debug-only: number of events replayed during recovery. */
  replayedEventsCount: 0,
  /** Debug-only: number of session-affecting events applied during recovery (ENTER/EXIT). */
  appliedSessionsCount: 0,
};

export function incBleMetric(key: keyof typeof bleMetrics) {
  bleMetrics[key]++;
}

export function getBleMetrics() {
  return { ...bleMetrics };
}

/** Increment replay metrics only when NODE_ENV is not production (debug-only). */
export function incBleReplayMetric(
  key: "replayedEventsCount" | "appliedSessionsCount"
): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  bleMetrics[key]++;
}
