import crypto from "crypto"

/**
 * BLE ingest HMAC helpers.
 *
 * Authentication contract (P0 hardening):
 *   signature = HMAC_SHA256(raw_request_body, gateway_secret) as hex
 *
 * The server recomputes the signature against the stored
 * `ble_gateways.gateway_secret` and compares in constant time. If the
 * signature is missing, malformed, or mismatched, the request is
 * rejected before any DB writes occur.
 */

export function computeBleSignature(rawBody: string, gatewaySecret: string): string {
  return crypto.createHmac("sha256", gatewaySecret).update(rawBody, "utf8").digest("hex")
}

export function verifyBleSignature(
  rawBody: string,
  gatewaySecret: string,
  providedHex: string,
): boolean {
  if (typeof providedHex !== "string") return false
  const cleaned = providedHex.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(cleaned)) return false
  let expected: Buffer
  let actual: Buffer
  try {
    expected = Buffer.from(computeBleSignature(rawBody, gatewaySecret), "hex")
    actual = Buffer.from(cleaned, "hex")
  } catch {
    return false
  }
  if (expected.length !== actual.length) return false
  try {
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Hash of the raw body for audit / dedupe bookkeeping. Full 64-char hex. */
export function hashRawBody(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody, "utf8").digest("hex")
}
