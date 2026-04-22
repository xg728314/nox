/**
 * Shared authenticated fetch wrapper.
 *
 * SECURITY (R-1 remediation):
 *   Previously this helper read `access_token` from `localStorage` and
 *   attached it as `Authorization: Bearer <token>`. That made any XSS
 *   on any page equivalent to full account takeover. The new transport
 *   uses the HttpOnly cookie `nox_access_token` set by the login route
 *   — the browser sends it automatically when we pass
 *   `credentials: "include"`, and page JavaScript cannot read it.
 *
 *   - NEVER read tokens from localStorage / sessionStorage / window.
 *   - NEVER send `Authorization: Bearer <anything>` from client code.
 *   - NEVER fall back to an unauthenticated request silently — if the
 *     caller needs auth, a 401 from the server is the correct signal.
 *
 *   Server routes continue to use `resolveAuthContext`, which now reads
 *   the cookie as the primary source (Bearer remains supported ONLY for
 *   server-to-server / scripts, not for browsers).
 *
 * Response handling:
 *   401/403 redirect is still the caller's responsibility. Callers keep
 *   doing `if (res.status === 401 || res.status === 403) router.push("/login")`.
 *   This keeps the helper usable from both hooks (no router) and
 *   components (router available).
 *
 * Perf logging:
 *   Wraps fetch with perfLog("api:start" / "api:end" / "api:throw").
 *   Transport behavior is unchanged.
 */
import { perfLog, perfNow } from "@/lib/debug/perfLog"

export async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  }
  const mergedHeaders = { ...baseHeaders, ...(opts?.headers as Record<string, string> | undefined) }
  const method = (opts?.method ?? "GET").toUpperCase()
  const t_start = perfNow()
  perfLog("api:start", { url, method })
  try {
    const res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: mergedHeaders,
    })
    perfLog("api:end", {
      url,
      method,
      status: res.status,
      ok: res.ok,
      ms: Math.round(perfNow() - t_start),
    })
    return res
  } catch (err) {
    perfLog("api:throw", {
      url,
      method,
      ms: Math.round(perfNow() - t_start),
      err: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
