/**
 * S-BLE-13: Memory-based Threshold Implementation (Fallback)
 * Single-process, non-distributed. Resets on restart.
 */

import type { ThresholdBackend } from "./thresholdBackend";

type Entry = { ts: number };

export class MemoryThresholdBackend implements ThresholdBackend {
  private failureStore = new Map<string, Entry[]>();
  private suppressionStore = new Map<string, number>();

  async checkThreshold(key: string, windowMs: number, threshold: number): Promise<boolean> {
    const now = Date.now();
    const cutoff = now - windowMs;

    const entries = this.failureStore.get(key) ?? [];
    const kept = entries.filter((e) => e.ts >= cutoff);
    kept.push({ ts: now });
    this.failureStore.set(key, kept);

    return kept.length >= threshold;
  }

  async shouldSuppress(key: string, suppressMs: number): Promise<boolean> {
    const lastSent = this.suppressionStore.get(key) ?? 0;
    const elapsed = Date.now() - lastSent;
    return elapsed < suppressMs;
  }

  async markAlertSent(key: string, suppressMs: number): Promise<void> {
    this.suppressionStore.set(key, Date.now());
    
    // Cleanup old suppressions
    if (this.suppressionStore.size > 1000) {
      const cutoff = Date.now() - suppressMs * 2;
      const toDelete: string[] = [];
      this.suppressionStore.forEach((ts, k) => {
        if (ts < cutoff) toDelete.push(k);
      });
      toDelete.forEach((k) => this.suppressionStore.delete(k));
    }
  }

  getBackendType() {
    return "memory" as const;
  }
}
