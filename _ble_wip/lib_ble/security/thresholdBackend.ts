/**
 * S-BLE-13 → S-BLE-16: Threshold Backend Interface
 * Abstraction for distributed-safe threshold tracking
 * Priority: Redis → DB → Memory
 */

export type ThresholdBackendType = "redis" | "db" | "memory" | "unavailable";

export interface ThresholdBackend {
  /**
   * Record a failure attempt and check if threshold is exceeded.
   * @param key - unique key (e.g., "ble:threshold:auth_invalid:ip:192.168.1.100")
   * @param windowMs - rolling window in milliseconds
   * @param threshold - count threshold
   * @returns true if threshold exceeded, false otherwise
   */
  checkThreshold(key: string, windowMs: number, threshold: number): Promise<boolean>;

  /**
   * Check if alert should be suppressed (recently sent).
   * @param key - suppression key (e.g., "ble:alert:BLE_SECURITY_AUTH_ATTACK")
   * @param suppressMs - suppression window in milliseconds
   * @returns true if should suppress, false if should send
   */
  shouldSuppress(key: string, suppressMs: number): Promise<boolean>;

  /**
   * Mark alert as sent.
   * @param key - suppression key
   * @param suppressMs - TTL in milliseconds
   */
  markAlertSent(key: string, suppressMs: number): Promise<void>;

  /**
   * Get backend type for observability.
   */
  getBackendType(): ThresholdBackendType;
}
