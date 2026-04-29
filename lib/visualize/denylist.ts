/**
 * Visualize layer — denylist for sensitive columns and tables.
 *
 * Conservative-by-default: anything matching SENSITIVE_COLUMN_RE is masked
 * (or omitted) before leaving the visualize layer. Tables in
 * BLOCKED_TABLES are never queried by introspection-driven views.
 *
 * Phase 1 sankey doesn't expose any PII directly (sums only), but these
 * helpers exist so future phases (entity graph, audit feed) inherit the
 * same guard from a single source of truth.
 */

/**
 * Column-name pattern for sensitive content. Case-insensitive.
 * Order matters only for readability — all patterns OR'd together.
 *   - secret / token / password / hash → credentials
 *   - phone / email                    → PII
 *   - account_number / iban            → financial PII
 *   - must_change_password             → security signal
 *   - gateway_secret                   → BLE auth
 */
export const SENSITIVE_COLUMN_RE =
  /(secret|token|password|passwd|pwd|hash|salt|phone|email|account_number|iban|must_change_password)/i

/**
 * Tables that auto-discovery (information_schema) MUST NOT expose
 * regardless of column patterns. Add new entries conservatively.
 */
export const BLOCKED_TABLES: ReadonlySet<string> = new Set([
  "auth_rate_limits",
  "ble_gateways", // contains gateway_secret; presence-only views can use ble_tag_presence
])

/**
 * Returns true if a column name matches the sensitive pattern.
 */
export function isSensitiveColumn(columnName: string): boolean {
  return SENSITIVE_COLUMN_RE.test(columnName)
}

/**
 * Returns true if a table is fully blocked from auto-exposure.
 */
export function isBlockedTable(tableName: string): boolean {
  return BLOCKED_TABLES.has(tableName)
}
