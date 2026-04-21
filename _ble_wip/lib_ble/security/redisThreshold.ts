/**
 * S-BLE-16: Redis-backed Threshold Implementation
 * High-performance distributed threshold tracking
 */

import type Redis from "ioredis";
import type { ThresholdBackend } from "./thresholdBackend";

export class RedisThresholdBackend implements ThresholdBackend {
  constructor(private redis: Redis) {}

  async checkThreshold(key: string, windowMs: number, threshold: number): Promise<boolean> {
    try {
      const now = Date.now();
      const cutoff = now - windowMs;

      await this.redis.zadd(key, now, `${now}`);
      
      await this.redis.zremrangebyscore(key, 0, cutoff);
      
      const count = await this.redis.zcard(key);
      
      await this.redis.expire(key, Math.ceil(windowMs / 1000) + 60);

      return count >= threshold;
    } catch (e) {
      console.warn("[redisThreshold] checkThreshold error:", e);
      return false;
    }
  }

  async shouldSuppress(key: string, suppressMs: number): Promise<boolean> {
    try {
      const result = await this.redis.get(key);
      return result !== null;
    } catch (e) {
      console.warn("[redisThreshold] shouldSuppress error:", e);
      return false;
    }
  }

  async markAlertSent(key: string, suppressMs: number): Promise<void> {
    try {
      const ttlSec = Math.ceil(suppressMs / 1000);
      await this.redis.set(key, "1", "EX", ttlSec);
    } catch (e) {
      console.warn("[redisThreshold] markAlertSent error:", e);
    }
  }

  getBackendType() {
    return "redis" as const;
  }
}
