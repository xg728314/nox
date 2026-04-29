/**
 * Visualize layer — read-only Supabase client wrapper.
 *
 * Goals:
 *   1. All visualize queries go through ONE wrapper, so any future audit
 *      / rate-limiting / observability hook lands in one place.
 *   2. Surface only `select`-style operations to callers. Mutating verbs
 *      (`insert`, `update`, `upsert`, `delete`) on the wrapped builder
 *      throw at runtime. This is a defence-in-depth — service-role key
 *      can write at the network level, but the visualize code path
 *      cannot reach those verbs.
 *
 * The underlying client is `getServiceClient()` (module singleton). RLS is
 * bypassed by service role; the route-level super_admin gate is the only
 * authorization check.
 */

import { getServiceClient } from "@/lib/supabase/serviceClient"
import type { SupabaseClient } from "@supabase/supabase-js"

const FORBIDDEN_VERBS = new Set([
  "insert",
  "update",
  "upsert",
  "delete",
])

class ReadOnlyViolationError extends Error {
  constructor(verb: string) {
    super(
      `[visualize] Forbidden mutation verb '${verb}' on read-only client. ` +
        `Visualize layer is read-only by contract.`,
    )
    this.name = "ReadOnlyViolationError"
  }
}

/**
 * Wraps a `from(table)` builder so that any forbidden verb throws.
 * Returns the original builder for `select` and any chainable filter
 * methods (eq, in, is, gte, lte, order, limit, range, group, etc.).
 */
function wrapBuilder<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && FORBIDDEN_VERBS.has(prop)) {
        throw new ReadOnlyViolationError(prop)
      }
      const value = Reflect.get(target, prop, receiver)
      // Bind methods so `this` resolves to the original builder.
      if (typeof value === "function") {
        return value.bind(target)
      }
      return value
    },
  })
}

/**
 * Read-only handle. Use `client.from(table)` exactly like the standard
 * Supabase client; mutating verbs throw at runtime.
 *
 * The `raw` accessor exists only for the audit-write helper in
 * `guards.ts` to log a single audit_events row per request. It is NOT
 * a general escape hatch — DO NOT call it from query modules.
 */
export type ReadClient = {
  from: (table: string) => ReturnType<SupabaseClient["from"]>
  /** Audit-write only. Restricted by convention; lint-grep enforced. */
  rawForAudit: () => SupabaseClient
}

export function getReadClient(): ReadClient {
  const supabase = getServiceClient()
  return {
    from: (table: string) => wrapBuilder(supabase.from(table)),
    rawForAudit: () => supabase,
  }
}
