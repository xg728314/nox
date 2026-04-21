/**
 * S-BLE-16: Redis Client for BLE Security Backend
 * Optional, lazy-initialized, fail-safe
 */

import "server-only";

import type Redis from "ioredis";

let redisClient: Redis | null = null;
let redisInitAttempted = false;
let redisAvailable = false;

function getRedisUrl(): string | null {
  try {
    const url = process.env.REDIS_URL ?? process.env.REDIS_CONNECTION_STRING ?? "";
    return url.trim() || null;
  } catch {
    return null;
  }
}

async function initRedis(): Promise<Redis | null> {
  if (redisInitAttempted) {
    return redisAvailable ? redisClient : null;
  }

  redisInitAttempted = true;

  const url = getRedisUrl();
  if (!url) {
    console.info("[redisClient] REDIS_URL not configured, using DB backend");
    return null;
  }

  try {
    const IORedis = (await import("ioredis")).default;
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    await client.connect();
    await client.ping();

    redisClient = client;
    redisAvailable = true;
    console.info("[redisClient] Redis connected successfully");
    return client;
  } catch (e) {
    console.warn("[redisClient] Redis connection failed, falling back to DB:", e);
    redisAvailable = false;
    return null;
  }
}

export async function getRedisClient(): Promise<Redis | null> {
  if (redisClient && redisAvailable) return redisClient;
  return await initRedis();
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}
