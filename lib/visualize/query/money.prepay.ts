/**
 * Visualize money — Q10 manager_prepayments helper.
 *
 * 2026-05-03: lib/visualize/query/money.ts 분할.
 *
 * 043 created `manager_prepayments`; 081 may have changed the shape. The
 * production schema is uncertain (status vs loan_status, presence of
 * business_day_id), so we attempt queries from most-specific to most-
 * generic. Each step is wrapped in try/catch so the visualize layer
 * NEVER 500s because of this helper.
 */

import type { ReadClient } from "../readClient"
import type { MoneyWarning } from "../shapes"

export type PrepayBlock = {
  amount: number
  tableUsed: string | null
  warning: MoneyWarning | null
}

type PrepayRow = Record<string, unknown>

function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function tryPrepayQuery(
  client: ReadClient,
  build: () => Promise<{ data: unknown; error: unknown } | unknown>,
): Promise<{ rows: PrepayRow[] | null; errMsg: string | null }> {
  try {
    const res = (await build()) as { data: unknown; error: { message?: string } | null }
    if (res.error) {
      return { rows: null, errMsg: res.error.message ?? "unknown" }
    }
    return { rows: ((res.data ?? []) as unknown) as PrepayRow[], errMsg: null }
  } catch (e) {
    return { rows: null, errMsg: e instanceof Error ? e.message : String(e) }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _hint() { void client }
}

function sumPrepay(rows: PrepayRow[]): number {
  let total = 0
  for (const r of rows) {
    // Status column might be 'loan_status' or 'status' — accept either.
    const raw = r.loan_status ?? r.status
    const status = raw == null ? "" : String(raw)
    if (status && status !== "approved") continue
    total += toNum(r.amount)
  }
  return total
}

export async function fetchPrepayments(
  client: ReadClient,
  store_uuid: string,
  business_day_id: string,
): Promise<PrepayBlock> {
  const tableName = "manager_prepayments"
  let businessDayScoped = true

  // Attempt 1: full shape — store_uuid + business_day_id + loan_status + soft-delete
  let attempt = await tryPrepayQuery(client, () =>
    client
      .from(tableName)
      .select("amount, loan_status")
      .eq("store_uuid", store_uuid)
      .eq("business_day_id", business_day_id)
      .is("deleted_at", null) as unknown as Promise<unknown>,
  )

  // Attempt 2: legacy column 'status' instead of 'loan_status'
  if (!attempt.rows) {
    attempt = await tryPrepayQuery(client, () =>
      client
        .from(tableName)
        .select("amount, status")
        .eq("store_uuid", store_uuid)
        .eq("business_day_id", business_day_id)
        .is("deleted_at", null) as unknown as Promise<unknown>,
    )
  }

  // Attempt 3: no business_day_id column — store-scoped sum (less precise)
  if (!attempt.rows) {
    businessDayScoped = false
    attempt = await tryPrepayQuery(client, () =>
      client
        .from(tableName)
        .select("amount, loan_status, status")
        .eq("store_uuid", store_uuid)
        .is("deleted_at", null) as unknown as Promise<unknown>,
    )
  }

  // Attempt 4: no soft-delete column either
  if (!attempt.rows) {
    attempt = await tryPrepayQuery(client, () =>
      client
        .from(tableName)
        .select("amount, loan_status, status")
        .eq("store_uuid", store_uuid) as unknown as Promise<unknown>,
    )
  }

  if (!attempt.rows) {
    return {
      amount: 0,
      tableUsed: null,
      warning: {
        type: "schema_missing_column",
        note: `${tableName} unavailable (${attempt.errMsg ?? "unknown"}). prepay_deduction set to 0.`,
      },
    }
  }

  const total = sumPrepay(attempt.rows)
  return {
    amount: total,
    tableUsed: tableName,
    warning: businessDayScoped
      ? null
      : {
          type: "schema_missing_column",
          note: `${tableName}.business_day_id column not found; prepay_deduction is store-wide, not day-scoped.`,
        },
  }
}
