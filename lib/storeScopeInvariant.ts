/**
 * Store-scope invariant.
 *
 * SECURITY (R-1 remediation):
 *   Previously this helper returned `localStorage.getItem("store_uuid")`.
 *   That value was UI-writable and therefore not a security invariant —
 *   it was a UX convenience at best. The server-side `resolveAuthContext`
 *   already returns the authoritative `store_uuid` for every API call.
 *
 *   We intentionally return the empty string here. Any caller that used
 *   this value to construct an API request should either (a) drop the
 *   field entirely (the server re-derives store_uuid from auth) or
 *   (b) read the value from `useCurrentProfile()` and treat it as UI
 *   hint only.
 *
 *   Kept as a no-op export to avoid breaking existing imports during
 *   the migration. New code should NOT call this.
 */
export function requireStoreId(): string {
  return ""
}
