/**
 * STEP-NEXT-SETTLEMENT-RELOCK-BACKFILL
 *
 * Recompute draft receipts created under the legacy settlement formula so they
 * conform to STEP-NEXT-SETTLEMENT-FORMULA-LOCK / -IMPLEMENTATION.
 *
 * Strict rules:
 *   - This script DOES NOT contain any settlement math. It only:
 *       1. Selects target draft receipts via Supabase
 *       2. Calls the live POST /api/sessions/settlement endpoint
 *          (the single source of truth, per the lock)
 *       3. Records and classifies the response
 *   - Finalized receipts are never touched (selection filters status='draft' only).
 *   - No deletion of any historical row.
 *   - Failure rows are classified, never silently dropped.
 *
 * Usage:
 *   # selection-only, no writes
 *   npx tsx scripts/backfill-settlement-relock.ts --dry-run
 *
 *   # real recompute (requires a per-store bearer token map)
 *   #   BACKFILL_TOKENS_JSON='{"<store_uuid>":"<bearer>", ...}' \
 *   #   npx tsx scripts/backfill-settlement-relock.ts --execute --base-url http://localhost:3000
 *
 *   # limit number of receipts processed (safety)
 *   npx tsx scripts/backfill-settlement-relock.ts --execute --limit 50
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role key (selection only)
 *   BACKFILL_TOKENS_JSON           — JSON map { store_uuid: bearer_token } (--execute only)
 */

import { createClient } from "@supabase/supabase-js"

type Mode = "dry-run" | "execute"

interface CliArgs {
  mode: Mode
  baseUrl: string
  limit: number | null
}

interface TargetRow {
  receipt_id: string
  session_id: string
  store_uuid: string
  old_version: number
  old_status: string
  formula_version: string | null
}

interface SuccessRow {
  receipt_id: string
  session_id: string
  store_uuid: string
  old_version: number
  new_version: number | null
  result: "recomputed"
}

type FailureCategory =
  | "REMAINDER_NEGATIVE"
  | "SESSION_NOT_CLOSED"
  | "BUSINESS_DAY_CLOSED"
  | "SOURCE_DATA_MISSING"
  | "ALREADY_FINALIZED"
  | "AUTH_MISSING_TOKEN"
  | "UNKNOWN_ERROR"

interface FailureRow {
  receipt_id: string
  session_id: string
  store_uuid: string
  http_status: number | null
  error_code: string | null
  message: string | null
  category: FailureCategory
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: "dry-run", baseUrl: "http://localhost:3000", limit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") args.mode = "dry-run"
    else if (a === "--execute") args.mode = "execute"
    else if (a === "--base-url") {
      const v = argv[i + 1]
      if (v) {
        args.baseUrl = v
        i++
      }
    } else if (a === "--limit") {
      const v = argv[i + 1]
      if (v) {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n)
        i++
      }
    }
  }
  return args
}

function classifyError(httpStatus: number | null, code: string | null): FailureCategory {
  if (code === "REMAINDER_NEGATIVE") return "REMAINDER_NEGATIVE"
  if (code === "SESSION_NOT_CLOSED") return "SESSION_NOT_CLOSED"
  if (code === "BUSINESS_DAY_CLOSED") return "BUSINESS_DAY_CLOSED"
  if (code === "ALREADY_FINALIZED") return "ALREADY_FINALIZED"
  if (
    code === "SESSION_NOT_FOUND" ||
    code === "NO_BUSINESS_DAY" ||
    code === "QUERY_FAILED" ||
    code === "BAD_REQUEST"
  ) {
    return "SOURCE_DATA_MISSING"
  }
  if (
    code === "AUTH_MISSING" ||
    code === "AUTH_INVALID" ||
    code === "MEMBERSHIP_NOT_FOUND" ||
    code === "MEMBERSHIP_INVALID" ||
    code === "MEMBERSHIP_NOT_APPROVED" ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return "AUTH_MISSING_TOKEN"
  }
  return "UNKNOWN_ERROR"
}

interface SettlementResponseShape {
  receipt_id?: string
  version?: number
  formula_version?: string
  error?: string
  message?: string
}

async function postSettlement(
  baseUrl: string,
  token: string,
  sessionId: string
): Promise<{ httpStatus: number; body: SettlementResponseShape | null }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/sessions/settlement`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
    })
  } catch {
    return { httpStatus: 0, body: { error: "NETWORK_ERROR", message: "fetch failed" } }
  }
  let body: SettlementResponseShape | null = null
  try {
    body = (await res.json()) as SettlementResponseShape
  } catch {
    body = null
  }
  return { httpStatus: res.status, body }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    process.exit(2)
  }

  let storeTokens: Record<string, string> = {}
  if (args.mode === "execute") {
    const raw = process.env.BACKFILL_TOKENS_JSON
    if (!raw) {
      console.error("ERROR: --execute requires BACKFILL_TOKENS_JSON env var")
      process.exit(2)
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object") {
        storeTokens = parsed as Record<string, string>
      }
    } catch {
      console.error("ERROR: BACKFILL_TOKENS_JSON is not valid JSON")
      process.exit(2)
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  console.log(`[backfill] mode=${args.mode} baseUrl=${args.baseUrl} limit=${args.limit ?? "none"}`)

  // 1. SELECT target receipts.
  //    Selection criteria from the brief:
  //      status = 'draft'
  //      AND (snapshot is null
  //           OR snapshot->>'formula_version' is null
  //           OR snapshot->>'formula_version' does not start with 'v2-relock')
  const pageSize = 1000
  let from = 0
  const targets: TargetRow[] = []
  for (;;) {
    const { data, error } = await supabase
      .from("receipts")
      .select("id, session_id, store_uuid, version, status, snapshot")
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) {
      console.error(`[backfill] receipts query failed: ${error.message}`)
      process.exit(2)
    }
    const rows = (data ?? []) as Array<{
      id: string
      session_id: string
      store_uuid: string
      version: number
      status: string
      snapshot: unknown
    }>
    if (rows.length === 0) break
    for (const r of rows) {
      let formulaVersion: string | null = null
      if (r.snapshot && typeof r.snapshot === "object") {
        const snap = r.snapshot as Record<string, unknown>
        const fv = snap.formula_version
        if (typeof fv === "string") formulaVersion = fv
      }
      const isRelocked = formulaVersion !== null && formulaVersion.startsWith("v2-relock")
      if (isRelocked) continue
      targets.push({
        receipt_id: r.id,
        session_id: r.session_id,
        store_uuid: r.store_uuid,
        old_version: r.version,
        old_status: r.status,
        formula_version: formulaVersion,
      })
    }
    if (rows.length < pageSize) break
    from += pageSize
  }

  // store-by-store breakdown
  const byStore = new Map<string, number>()
  for (const t of targets) {
    byStore.set(t.store_uuid, (byStore.get(t.store_uuid) ?? 0) + 1)
  }
  const { data: storeRows } = await supabase
    .from("stores")
    .select("id, store_name")
    .in("id", Array.from(byStore.keys()).slice(0, 1000))
  const storeNameById = new Map<string, string>()
  for (const s of (storeRows ?? []) as Array<{ id: string; store_name: string }>) {
    storeNameById.set(s.id, s.store_name)
  }

  console.log(`[backfill] total target receipts (status=draft, formula_version != v2-relock): ${targets.length}`)
  for (const [storeId, count] of Array.from(byStore.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${storeNameById.get(storeId) ?? storeId}: ${count}`)
  }

  if (args.mode === "dry-run") {
    console.log("[backfill] dry-run complete. No writes performed.")
    process.exit(0)
  }

  // 2. EXECUTE — recompute via live route.
  const successes: SuccessRow[] = []
  const failures: FailureRow[] = []
  const queue = args.limit ? targets.slice(0, args.limit) : targets

  for (const t of queue) {
    const token = storeTokens[t.store_uuid]
    if (!token) {
      failures.push({
        receipt_id: t.receipt_id,
        session_id: t.session_id,
        store_uuid: t.store_uuid,
        http_status: null,
        error_code: "AUTH_MISSING_TOKEN",
        message: "no bearer token provided for this store_uuid",
        category: "AUTH_MISSING_TOKEN",
      })
      continue
    }
    const { httpStatus, body } = await postSettlement(args.baseUrl, token, t.session_id)
    if (httpStatus >= 200 && httpStatus < 300 && body && body.formula_version && body.formula_version.startsWith("v2-relock")) {
      successes.push({
        receipt_id: body.receipt_id ?? t.receipt_id,
        session_id: t.session_id,
        store_uuid: t.store_uuid,
        old_version: t.old_version,
        new_version: body.version ?? null,
        result: "recomputed",
      })
    } else {
      const code = body?.error ?? null
      failures.push({
        receipt_id: t.receipt_id,
        session_id: t.session_id,
        store_uuid: t.store_uuid,
        http_status: httpStatus,
        error_code: code,
        message: body?.message ?? null,
        category: classifyError(httpStatus, code),
      })
    }
  }

  // 3. REPORT.
  console.log("")
  console.log(`[backfill] processed=${queue.length} success=${successes.length} failed=${failures.length}`)
  const failureByCategory = new Map<FailureCategory, number>()
  for (const f of failures) {
    failureByCategory.set(f.category, (failureByCategory.get(f.category) ?? 0) + 1)
  }
  console.log("[backfill] failures by category:")
  for (const [cat, n] of failureByCategory.entries()) {
    console.log(`  - ${cat}: ${n}`)
  }
  console.log("[backfill] sample failures (up to 10):")
  for (const f of failures.slice(0, 10)) {
    console.log(
      `  ${f.category} receipt=${f.receipt_id} session=${f.session_id} http=${f.http_status} code=${f.error_code} msg=${f.message}`
    )
  }

  // store-by-store success breakdown
  const successByStore = new Map<string, number>()
  for (const s of successes) successByStore.set(s.store_uuid, (successByStore.get(s.store_uuid) ?? 0) + 1)
  console.log("[backfill] store-by-store success counts:")
  for (const [storeId, count] of successByStore.entries()) {
    console.log(`  - ${storeNameById.get(storeId) ?? storeId}: ${count}`)
  }

  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[backfill] fatal: ${msg}`)
  process.exit(2)
})
