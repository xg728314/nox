/**
 * Non-UI diagnostics for BLE pipeline (debug-gated).
 * Logs summary counts: received / deduped / applied.
 */

import { pushLog } from "./log";

let received = 0;
let deduped = 0;
let applied = 0;

export function incBleDiagReceived(n = 1): void {
  received += n;
}

export function incBleDiagDeduped(n = 1): void {
  deduped += n;
}

export function incBleDiagApplied(n = 1): void {
  applied += n;
}

/** Log summary and reset counts. Call when debug mode; no-op otherwise. */
export function logBleDiagSummaryAndReset(isDebug: boolean): void {
  if (!isDebug || (received === 0 && deduped === 0 && applied === 0)) {
    received = 0;
    deduped = 0;
    applied = 0;
    return;
  }
  pushLog(`[BLE_DIAG] received=${received} deduped=${deduped} applied=${applied}`, "info");
  received = 0;
  deduped = 0;
  applied = 0;
}

export function getBleDiagCounts(): { received: number; deduped: number; applied: number } {
  return { received, deduped, applied };
}
