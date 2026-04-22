/**
 * Isomorphic perf logger.
 *
 * - On client, gated by `window.__nox_perf__ === true`. When true, emits
 *   `console.log("[perf]", tag, payload)`. When false, silent.
 * - On server (no window), always emits (Vercel log capture picks it up).
 *
 * `perfNow()` picks `performance.now()` on client, `Date.now()` on server.
 * `PERF_INSTANCE_ID` is a short random id for the running instance, stable
 * across calls within the same module load.
 */

export const PERF_INSTANCE_ID: string = Math.random().toString(36).slice(2, 8)

export function perfNow(): number {
  if (typeof window !== "undefined" && typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

export function perfLog(tag: string, extra?: Record<string, unknown>): void {
  const payload = { id: PERF_INSTANCE_ID, ...(extra ?? {}) }
  if (typeof window === "undefined") {
    // Server: always emit.
    // eslint-disable-next-line no-console
    console.log("[perf]", tag, payload)
    return
  }
  // Client: gated by window.__nox_perf__ flag.
  const flag = (globalThis as unknown as { __nox_perf__?: boolean }).__nox_perf__
  if (flag === true) {
    // eslint-disable-next-line no-console
    console.log("[perf]", tag, payload)
  }
}
