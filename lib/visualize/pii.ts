/**
 * Visualize layer — PII masking helpers.
 *
 * Default: everything is masked. Unmask is allowed only when an explicit
 * `unmask=true` query param is paired with a super_admin caller AND the
 * route writes an audit_events row before returning unmasked data
 * (the route, not this module, is responsible for the audit write).
 *
 * Phase 1 sankey doesn't surface any PII fields directly. These helpers
 * are available for later phases (entity graph, audit feed, drill-down).
 */

import { isSensitiveColumn } from "./denylist"

/**
 * Mask a phone string. Keeps the last 4 digits if at least 8 digits exist.
 *   "010-1234-5678" → "***-****-5678"
 *   "01099991111"   → "*******1111"
 *   ""              → ""
 *   null/undefined  → ""
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  if (digits.length < 8) return "*".repeat(value.length)
  const visible = digits.slice(-4)
  // Preserve original separators length-wise by replacing each non-tail char.
  const tailStart = value.length - 4
  let out = ""
  for (let i = 0; i < value.length; i++) {
    if (i >= tailStart) out += value[i]
    else out += /\d/.test(value[i]) ? "*" : value[i]
  }
  // If the original had fewer than 4 trailing digits we still show the last 4 digits literally.
  if (!out.endsWith(visible)) {
    return `${"*".repeat(Math.max(0, value.length - 4))}${visible}`
  }
  return out
}

/**
 * Mask a personal name. Keeps the first character.
 *   "홍길동"       → "홍**"
 *   "김"           → "*"
 *   ""             → ""
 */
export function maskName(value: string | null | undefined): string {
  if (!value) return ""
  if (value.length <= 1) return "*"
  return value[0] + "*".repeat(value.length - 1)
}

/**
 * Mask an account number. Keeps the last 3 digits.
 *   "1234-56-789012" → "*********9012" (after stripping separators length kept)
 */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return ""
  if (value.length <= 3) return "*".repeat(value.length)
  return "*".repeat(value.length - 3) + value.slice(-3)
}

/**
 * Mask an email. Keeps the first character of the local part and the domain.
 *   "alice@example.com" → "a****@example.com"
 *   "x@y"               → "*@y"
 */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return ""
  const at = value.indexOf("@")
  if (at <= 0) return "*".repeat(value.length)
  const local = value.slice(0, at)
  const domain = value.slice(at)
  if (local.length <= 1) return `*${domain}`
  return `${local[0]}${"*".repeat(local.length - 1)}${domain}`
}

/**
 * Walk a flat object and mask values whose keys match the sensitive pattern.
 * Non-string values are coerced via String(...) before masking.
 *
 * NOTE: this only walks one level. Deep walks risk traversing ad-hoc shapes
 * and silently exposing nested PII; we keep it shallow on purpose. Callers
 * must shape rows explicitly before passing.
 */
export function maskRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!isSensitiveColumn(k) || v == null) {
      out[k] = v
      continue
    }
    const s = typeof v === "string" ? v : String(v)
    if (/phone/i.test(k)) out[k] = maskPhone(s)
    else if (/email/i.test(k)) out[k] = maskEmail(s)
    else if (/account_number|iban/i.test(k)) out[k] = maskAccount(s)
    else out[k] = "***"
  }
  return out as T
}
