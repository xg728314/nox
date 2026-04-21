/**
 * STEP-013D: server-side encryption envelope for MFA secrets and
 * keyed hashing for trusted device identifiers.
 *
 * Secret material source: env `MFA_SECRET_KEY` — 32 raw bytes encoded
 * as base64. Fail loudly at call time if missing so we never silently
 * encrypt with a weak key. This module never logs the key, the IV, or
 * the plaintext.
 *
 *   encryptSecret(buf)               → {iv, ciphertext, auth_tag}
 *   decryptSecret({iv, ciphertext, auth_tag}) → Buffer
 *   hashDevice(user_id, device_id)   → hex string (HMAC-SHA256)
 */

import crypto from "node:crypto"

function getKey(): Buffer {
  const raw = process.env.MFA_SECRET_KEY
  if (!raw) throw new Error("MFA_SECRET_KEY missing")
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) throw new Error("MFA_SECRET_KEY must decode to 32 bytes")
  return buf
}

export type EncryptedEnvelope = {
  iv: Buffer
  ciphertext: Buffer
  auth_tag: Buffer
}

export function encryptSecret(plaintext: Buffer): EncryptedEnvelope {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const auth_tag = cipher.getAuthTag()
  return { iv, ciphertext, auth_tag }
}

export function decryptSecret(env: EncryptedEnvelope): Buffer {
  const key = getKey()
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, env.iv)
  decipher.setAuthTag(env.auth_tag)
  return Buffer.concat([decipher.update(env.ciphertext), decipher.final()])
}

export function hashDevice(userId: string, clientDeviceId: string): string {
  const key = getKey()
  return crypto
    .createHmac("sha256", key)
    .update(`${userId}|${clientDeviceId}`)
    .digest("hex")
}
