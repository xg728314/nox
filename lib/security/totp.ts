/**
 * STEP-013D: minimal RFC-6238 TOTP implementation.
 *
 * Uses only `node:crypto` — no new dependencies. Produces Google
 * Authenticator / Authy compatible 6-digit codes at 30s intervals.
 *
 *   generateSecret()      → raw 20-byte Buffer (HOTP/TOTP recommended)
 *   encodeBase32(buf)     → RFC-4648 base32 string for otpauth URIs
 *   buildOtpauthUri(...)  → otpauth://totp/... URI for QR generation
 *   verifyTotp(secret, code, now?, window?) → boolean
 *
 * A 1-step ± window is used by default to tolerate clock drift (90s
 * effective acceptance window). Constant-time comparison avoids timing
 * leaks on the code match.
 */

import crypto from "node:crypto"

const STEP_SECONDS = 30
const DIGITS = 6

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateSecret(bytes: number = 20): Buffer {
  return crypto.randomBytes(bytes)
}

export function encodeBase32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  return out
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // JS numbers only reach 2^53; 30s counter remains safe for ~285 million years.
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0")
}

export function generateTotp(secret: Buffer, atSeconds?: number): string {
  const t = Math.floor((atSeconds ?? Date.now() / 1000) / STEP_SECONDS)
  return hotp(secret, t)
}

export function verifyTotp(
  secret: Buffer,
  code: string,
  atSeconds?: number,
  window: number = 1
): boolean {
  if (typeof code !== "string") return false
  const trimmed = code.trim()
  if (!/^\d{6}$/.test(trimmed)) return false
  const t = Math.floor((atSeconds ?? Date.now() / 1000) / STEP_SECONDS)
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, t + i)
    const a = Buffer.from(expected)
    const b = Buffer.from(trimmed)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  }
  return false
}

export function buildOtpauthUri(params: {
  secretBase32: string
  accountName: string
  issuer: string
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`)
  const qs = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${qs.toString()}`
}
