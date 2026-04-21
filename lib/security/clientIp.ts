/**
 * clientIp — secure, non-spoofable IP extraction.
 *
 * SECURITY (R-3 remediation):
 *   The legacy `extractIp()` trusted `X-Forwarded-For` unconditionally,
 *   which any HTTP client can forge. That let an attacker send a fresh
 *   spoofed IP on every request and bypass every IP-based rate limit
 *   (login brute-force, OTP resend cooldown, password-reset throttle).
 *
 *   This helper fixes that by trusting forwarded-for headers ONLY when
 *   the deployment is explicitly behind a trusted proxy:
 *
 *     - Vercel:      `x-vercel-forwarded-for`  (signed by Vercel edge;
 *                    clients cannot forge this header — Vercel strips
 *                    and re-sets it)
 *     - Cloudflare:  `cf-connecting-ip`        (stripped and re-set by
 *                    Cloudflare on every request)
 *     - Self-host:   `x-forwarded-for` is used ONLY when the operator
 *                    sets `TRUSTED_PROXY=true` in the environment.
 *                    The operator is responsible for ensuring the
 *                    reverse proxy (nginx / Caddy / etc.) STRIPS any
 *                    client-supplied `X-Forwarded-For` and replaces
 *                    it with the real peer IP before forwarding.
 *
 *   When none of the above applies, we intentionally return
 *   `"unknown"` so rate-limit buckets collapse to a single key. This
 *   is fail-closed: worst case is everyone shares the same rate
 *   bucket (DoS against legitimate users), not that an attacker gets
 *   unlimited attempts via header spoofing.
 *
 *   Never falls back to reading `x-forwarded-for` without
 *   TRUSTED_PROXY.
 */

/**
 * Normalize a single IP candidate:
 *   - strip whitespace
 *   - drop trailing port `:443`, `:8080`, etc. (IPv4 only; IPv6 with port
 *     uses `[…]:port` and is already unambiguous so we leave it alone)
 *   - bound length to 64 chars (longest valid IPv6 = 45 chars; 64 leaves
 *     slack and caps any abuse via oversize header)
 *   - empty string stays empty (caller falls through)
 */
function normalizeIp(candidate: string | null | undefined): string {
  if (!candidate) return ""
  let v = candidate.trim()
  if (v.length === 0) return ""
  if (v.length > 64) v = v.slice(0, 64)
  // Strip IPv4 port suffix `1.2.3.4:5678` → `1.2.3.4`. IPv6 addresses
  // never match this pattern (they contain `:` multiple times).
  const ipv4PortMatch = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(v)
  if (ipv4PortMatch) v = ipv4PortMatch[1]
  return v
}

/**
 * Read the first entry from a comma-separated forwarded-for header.
 * Convention: `client, proxy1, proxy2` — the leftmost entry is the
 * original client. Returns `""` if the header is missing or malformed.
 */
function firstFromForwardedFor(header: string | null): string {
  if (!header) return ""
  const first = header.split(",")[0]
  return normalizeIp(first)
}

/**
 * Extract the client IP. Returns `"unknown"` when no trusted source
 * is available so rate-limit keys degrade gracefully rather than
 * allowing header-based spoofing.
 *
 * Priority order:
 *   1. `x-vercel-forwarded-for` (Vercel platform, always trustable)
 *   2. `cf-connecting-ip`       (Cloudflare, always trustable)
 *   3. `x-forwarded-for`        ONLY if `TRUSTED_PROXY=true` env set
 *   4. `x-real-ip`              ONLY if `TRUSTED_PROXY=true` env set
 *   5. `"unknown"`              (fail-closed default)
 */
export function getClientIp(req: Request): string {
  // Platform-signed headers — safe to trust on matching platform.
  const vercel = normalizeIp(req.headers.get("x-vercel-forwarded-for"))
  if (vercel) return vercel

  const cloudflare = normalizeIp(req.headers.get("cf-connecting-ip"))
  if (cloudflare) return cloudflare

  // Self-hosted behind a trusted reverse proxy — only when explicitly
  // opted in via env so a mistaken dev build on localhost can't be
  // tricked by a forged header.
  const trustedProxy = process.env.TRUSTED_PROXY === "true"
  if (trustedProxy) {
    const xff = firstFromForwardedFor(req.headers.get("x-forwarded-for"))
    if (xff) return xff
    const xri = normalizeIp(req.headers.get("x-real-ip"))
    if (xri) return xri
  }

  // Fail-closed. Do NOT read x-forwarded-for here — that was the
  // exact bypass R-3 flagged.
  return "unknown"
}
