/**
 * PostgREST filter-value escapers.
 *
 * SECURITY (R-4 remediation):
 *   Supabase's query builder parameterizes scalar values when you use
 *   `.eq(col, value)` / `.ilike(col, value)` etc. — the VALUES are
 *   sent as query parameters and cannot escape into the filter tree.
 *
 *   HOWEVER, two patterns were unsafe in the codebase:
 *
 *     A) LIKE / ILIKE wildcard injection.
 *        `%` and `_` are wildcards in SQL LIKE. When the app does
 *          .ilike("name", `%${q}%`)
 *        a malicious `q = "%"` matches every row, and
 *          q = "_____%" triggers an O(N * pattern) full scan.
 *        Not strictly an injection but a DoS / data-exfiltration vector.
 *        Fix: `escapeLikeValue()` prefixes `\` in front of the three
 *        wildcard chars PostgreSQL treats as LIKE-special (`%`, `_`, `\`).
 *
 *     B) `.or()` string composition.
 *        PostgREST's `.or()` accepts a comma-separated filter expression:
 *          .or(`a.ilike.%${q}%,b.eq.${q}`)
 *        The expression is parsed BEFORE values are escaped, so a `q`
 *        containing `,`, `.`, `(`, `)` can inject arbitrary filter
 *        clauses into the WHERE tree — full bypass of access policy.
 *        Fix: `escapePostgrestOrSegment()` rejects any of these chars
 *        outright (returns `null`) and also escapes LIKE wildcards for
 *        `ilike`/`like` operators. Callers MUST treat `null` as "reject
 *        the request" — fail-closed.
 *
 *   These helpers are PURE — no I/O — and are the single source of
 *   truth for "is this user input safe to splice into a filter string".
 */

/** Max bytes/chars accepted before rejecting. Keeps DoS small. */
const MAX_USER_FILTER_LEN = 120

/**
 * Escape a value before passing it as the second arg to
 * `.ilike(col, value)` or `.like(col, value)`.
 *
 * Converts `%`, `_`, `\` into their escaped equivalents so a user's
 * literal `%` is matched as the character `%`, not as "match anything".
 * The surrounding `%…%` the CALLER adds (for substring search) is NOT
 * touched — that's the intended wildcard.
 *
 * Returns `null` if input is too long (caller should reject the req).
 */
export function escapeLikeValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return ""
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ""
  if (trimmed.length > MAX_USER_FILTER_LEN) return null
  // Order matters: escape backslash first so subsequent replacements
  // don't double-escape the inserted `\`.
  return trimmed
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

/**
 * Guard for user input that will be spliced into a `.or()` expression.
 *
 * Returns the safely-formatted value, or `null` if the input contains
 * any PostgREST filter meta-character. Callers MUST treat `null` as a
 * 400 BAD_REQUEST and refuse to run the query.
 *
 * @param raw       user-supplied string
 * @param mode      how the value will be used inside the expression:
 *                  - "ilike" / "like"  → LIKE wildcards are escaped,
 *                                        `%…%` is added by the caller
 *                  - "eq" / "plain"    → value is compared literally;
 *                                        any `%` / `_` would be a bug
 *                                        in the caller's intent
 */
export function escapePostgrestOrSegment(
  raw: string | null | undefined,
  mode: "ilike" | "like" | "eq" | "plain" = "plain",
): string | null {
  if (typeof raw !== "string") return ""
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ""
  if (trimmed.length > MAX_USER_FILTER_LEN) return null

  // REJECT any PostgREST meta-character. These are the ways user
  // input could escape into the filter grammar:
  //   `,`  — clause separator
  //   `.`  — operator separator (field.op.value)
  //   `(` `)`  — logical grouping
  //   `"` `'`  — string quoting
  //   `*`  — pattern expansion (some operators)
  //   `\`  — escape (allow only via our controlled LIKE escape below)
  //
  // Anything with these chars is suspicious; we do not try to
  // sanitize — we refuse. Fail-closed.
  if (/[,.()\"'*\\]/.test(trimmed)) return null

  // Control chars and NUL — reject.
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null

  if (mode === "ilike" || mode === "like") {
    // LIKE wildcards still need escaping since the caller will wrap
    // with `%…%` to express "contains". PostgREST passes the raw
    // value to PostgreSQL's LIKE operator.
    return trimmed
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
  }

  // `eq`/`plain`: `%` and `_` have no meaning with `eq`, but an input
  // containing them is still suspicious enough to reject given we've
  // already blocked the other meta-chars above. We allow them through
  // so the comparison just never matches, rather than 400'ing on an
  // odd-but-harmless input.
  return trimmed
}

/**
 * UUID validator. Safe to splice into `.or()` expressions when the
 * source is auth-context-provided (server-trusted) and we want a
 * defence-in-depth check that nothing has been mis-typed.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertUuidForOr(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (!UUID_REGEX.test(value)) return null
  return value
}
