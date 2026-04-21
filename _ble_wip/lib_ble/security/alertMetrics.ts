/**
 * S-BLE-17: In-memory metrics for alert suppression observability
 * Tracks decision sources, backend health, and fail-open situations
 */

export interface AlertMetrics {
  redis_hit: number;
  redis_miss: number;
  db_allow: number;
  db_suppress: number;
  redis_error: number;
  db_error: number;
  fail_open: number;
}

class AlertMetricsCollector {
  private metrics: AlertMetrics = {
    redis_hit: 0,
    redis_miss: 0,
    db_allow: 0,
    db_suppress: 0,
    redis_error: 0,
    db_error: 0,
    fail_open: 0,
  };

  increment(counter: keyof AlertMetrics): void {
    this.metrics[counter]++;
  }

  getSnapshot(): AlertMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      redis_hit: 0,
      redis_miss: 0,
      db_allow: 0,
      db_suppress: 0,
      redis_error: 0,
      db_error: 0,
      fail_open: 0,
    };
  }
}

export const alertMetrics = new AlertMetricsCollector();
