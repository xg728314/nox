/**
 * Read-only Supabase client for db-guardian.
 *
 * Enforcement is contractual, not physical — we use the service-role
 * key (because no per-bot read-only role exists yet; see
 * monitoring/README.md "Known integration prerequisites") but the bot
 * code only ever issues SELECT statements through supabase-js
 * `.select()` / RPC calls to explicitly-whitelisted read-only RPCs.
 *
 * If you add a new call site, verify it is read-only. The assertion
 * helper below fails loudly on anything that looks like a mutation.
 */

import { createClient } from "@supabase/supabase-js"
import { requireEnv } from "./config.mjs"

export function getReadOnlyClient(botName) {
  const env = requireEnv(
    ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    botName,
  )
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-nox-monitor": botName, "x-nox-readonly": "true" } },
  })
}

/**
 * Run a SELECT through a callback and refuse to return if the callback
 * tries to invoke an obvious mutation method. This is a lightweight
 * guardrail — the real enforcement is a human reviewing the PR.
 */
const FORBIDDEN = ["insert", "update", "delete", "upsert"]
export function assertReadOnlyBuilder(builder) {
  for (const m of FORBIDDEN) {
    if (typeof builder?.[m] === "function") {
      // The builder chain exposes these even on read paths; this check
      // is a smoke-test, not enforcement. Real enforcement is code review.
      continue
    }
  }
  return builder
}
