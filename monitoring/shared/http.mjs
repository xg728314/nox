/**
 * HTTP probe utility. Thin wrapper over global `fetch` that captures
 * timing and surfaces network errors as explicit `{ ok: false,
 * reason: "network_error" }` results rather than throwing.
 *
 * Every probe result is shaped the same way so bot logic can compose
 * severity without branching on exception vs. HTTP 5xx.
 */

export async function probe(url, init = {}, { timeoutMs = 8000 } = {}) {
  const started = Date.now()
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    const elapsedMs = Date.now() - started
    let body = null
    const ct = res.headers.get("content-type") ?? ""
    try {
      body = ct.includes("application/json") ? await res.json() : await res.text()
    } catch {
      body = null
    }
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      body,
      headers: Object.fromEntries(res.headers.entries()),
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      body: null,
      headers: {},
      reason: e?.name === "AbortError" ? "timeout" : "network_error",
      message: e?.message,
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Extract the Set-Cookie value for a named cookie from a probe result.
 * Used by cutover-sentry to carry `nox_access_token` between the login
 * probe and the /me + /logout probes.
 */
export function extractCookie(headers, name) {
  const setCookie = headers["set-cookie"]
  if (!setCookie) return null
  // Node's fetch combines multiple Set-Cookie into a single comma-
  // separated string. Split conservatively on `, name=`.
  const hay = Array.isArray(setCookie) ? setCookie.join("\n") : setCookie
  const m = new RegExp(`(?:^|[,\\n])\\s*${name}=([^;]+)`).exec(hay)
  return m ? m[1] : null
}
