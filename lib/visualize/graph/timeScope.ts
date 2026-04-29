/**
 * Visualize Phase 2 — time scope resolver.
 *
 * Converts a `NetworkTimeRange` selection into:
 *   - a [from, to] KST business_date pair (yyyy-mm-dd, inclusive)
 *   - a list of `store_operating_days.id` UUIDs that fall in that range
 *
 * Read-only. Imports `lib/time/businessDate.ts` for KST date math
 * (it's a pure date utility, not business state).
 */

import {
  getBusinessDateForOps,
  getBusinessDateKST,
} from "@/lib/time/businessDate"
import type { ReadClient } from "../readClient"
import type {
  NetworkTimeRange,
  NetworkScopeKind,
} from "../shapes"

/** Maximum allowed window in days for `time_range='custom'`. */
export const CUSTOM_RANGE_MAX_DAYS = 30

export type TimeScopeInput = {
  time_range: NetworkTimeRange
  /** Required when time_range='custom'. yyyy-mm-dd KST. */
  from?: string | null
  /** Required when time_range='custom'. yyyy-mm-dd KST inclusive. */
  to?: string | null
}

export type TimeScopeResolved = {
  ok: true
  from: string
  to: string
}

export type TimeScopeError = {
  ok: false
  error: "BAD_REQUEST" | "RANGE_TOO_WIDE"
  message: string
}

export type ScopeStoreInput = {
  scope_kind: NetworkScopeKind
  /** Required when scope_kind='store'. */
  store_uuid?: string | null
}

/**
 * Resolve a `NetworkTimeRange` into an inclusive yyyy-mm-dd window in KST
 * business-date terms. Pure function.
 *
 * Rules:
 *   today        → [opsToday, opsToday]   (operations rollover at 06:00 KST)
 *   yesterday    → [opsToday - 1d, opsToday - 1d]
 *   last_7_days  → [opsToday - 6d, opsToday]
 *   this_month   → [first-of-month KST,    opsToday]
 *   custom       → [from, to] (inclusive). Rejects window > CUSTOM_RANGE_MAX_DAYS
 */
export function resolveTimeRange(
  input: TimeScopeInput,
  now: Date = new Date(),
): TimeScopeResolved | TimeScopeError {
  const opsToday = getBusinessDateForOps(now)
  const calToday = getBusinessDateKST(now) // for this_month month boundary

  switch (input.time_range) {
    case "today":
      return { ok: true, from: opsToday, to: opsToday }
    case "yesterday": {
      const y = addDays(opsToday, -1)
      return { ok: true, from: y, to: y }
    }
    case "last_7_days":
      return { ok: true, from: addDays(opsToday, -6), to: opsToday }
    case "this_month": {
      const first = `${calToday.slice(0, 7)}-01`
      return { ok: true, from: first, to: opsToday }
    }
    case "custom": {
      const from = input.from?.trim() || ""
      const to = input.to?.trim() || ""
      if (!isYmd(from) || !isYmd(to)) {
        return {
          ok: false,
          error: "BAD_REQUEST",
          message: "custom time_range requires from and to as yyyy-mm-dd.",
        }
      }
      if (from > to) {
        return {
          ok: false,
          error: "BAD_REQUEST",
          message: "from must be <= to.",
        }
      }
      const days = daysBetween(from, to) + 1
      if (days > CUSTOM_RANGE_MAX_DAYS) {
        return {
          ok: false,
          error: "RANGE_TOO_WIDE",
          message: `custom range max is ${CUSTOM_RANGE_MAX_DAYS} days (got ${days}).`,
        }
      }
      return { ok: true, from, to }
    }
    default:
      return {
        ok: false,
        error: "BAD_REQUEST",
        message: `unknown time_range: ${String(input.time_range)}`,
      }
  }
}

export type BusinessDayRow = {
  id: string
  store_uuid: string
  business_date: string
  status: string
}

export type ResolveBusinessDaysOk = {
  ok: true
  rows: BusinessDayRow[]
  ids: string[]
}

export type ResolveBusinessDaysErr = {
  ok: false
  error: string
  message: string
}

/**
 * Fetch `store_operating_days` rows that fall within [from, to], optionally
 * filtered to one store. Read-only.
 *
 * Returns the full row list (so the caller can warn on missing days for
 * a store that should have been open) and a flat id[] for IN-list use.
 */
export async function resolveBusinessDays(
  client: ReadClient,
  input: ScopeStoreInput & { from: string; to: string },
): Promise<ResolveBusinessDaysOk | ResolveBusinessDaysErr> {
  let q = client
    .from("store_operating_days")
    .select("id, store_uuid, business_date, status")
    .gte("business_date", input.from)
    .lte("business_date", input.to)
    .is("deleted_at", null)

  if (input.scope_kind === "store") {
    if (!input.store_uuid) {
      return {
        ok: false,
        error: "BAD_REQUEST",
        message: "scope='store' requires store_uuid.",
      }
    }
    q = q.eq("store_uuid", input.store_uuid)
  }

  const { data, error } = await q
  if (error) {
    return {
      ok: false,
      error: "QUERY_FAILED",
      message: `store_operating_days: ${error.message}`,
    }
  }
  const rows = (data ?? []) as BusinessDayRow[]
  return { ok: true, rows, ids: rows.map((r) => r.id) }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x))
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  const ms = Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)
  return Math.round(ms / 86_400_000)
}
