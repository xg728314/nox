/**
 * Visualize seed — cleanup script.
 *
 * Removes EVERYTHING produced by `seed.ts`. Safe by default: runs as
 * dry-run unless `--confirm` is passed. Operational data is never
 * touched — every WHERE clause is anchored on either:
 *   - test_store_uuid IN (TEST_STORE_UUIDS)  (deterministic test UUIDs)
 *   - test_user_id    IN (auth.users WHERE email LIKE '%@nox-seed.test')
 *
 * Auth users are deleted via supabase.auth.admin.deleteUser; DB rows
 * via service-role table DELETE.
 *
 * Run dry-run:  npx tsx scripts/visualize-seed/cleanup.ts
 * Run confirm:  npx tsx scripts/visualize-seed/cleanup.ts --confirm
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  TEST_EMAIL_DOMAIN,
  TEST_STORE_UUIDS,
} from "./constants"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[cleanup] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const CONFIRM = process.argv.includes("--confirm")

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[cleanup] ${msg}`)
}

function warn(msg: string) {
  // eslint-disable-next-line no-console
  console.warn(`[cleanup] WARN ${msg}`)
}

// ─── Per-table DELETE recipes ───────────────────────────────────────
//
// Each entry is applied in order (top-down = reverse FK dependency).
// `applyDelete` returns the count or throws; in dry-run we only count.

type Recipe =
  | {
      table: string
      kind: "store_scoped"
    }
  | {
      table: string
      kind: "store_scoped_with_actor"
      actor_column: string
    }
  | {
      table: string
      kind: "or_two_columns"
      column_a: string
      column_b: string
    }
  | {
      table: string
      kind: "id_in_list"
      column: string
      ids: string[]
    }

function buildRecipes(testStoreUuids: string[], testUserIds: string[]): Recipe[] {
  return [
    // 1. audit_events — store_uuid OR actor_profile_id
    {
      table: "audit_events",
      kind: "store_scoped_with_actor",
      actor_column: "actor_profile_id",
    },
    // 2. payout_records, settlement_items, settlements — store_uuid only
    { table: "payout_records", kind: "store_scoped" },
    { table: "settlement_items", kind: "store_scoped" },
    { table: "settlements", kind: "store_scoped" },
    // 3. orders, receipts, receipt_snapshots
    { table: "orders", kind: "store_scoped" },
    { table: "receipts", kind: "store_scoped" }, // no soft-delete column
    { table: "receipt_snapshots", kind: "store_scoped" },
    // 4. session_participants, room_sessions
    { table: "session_participants", kind: "store_scoped" },
    { table: "room_sessions", kind: "store_scoped" },
    // 5. cross_store — both directions.
    // Items table kept legacy `store_uuid`/`target_store_uuid` columns.
    // Header table dropped them in migration 038 — uses
    // `from_store_uuid` / `to_store_uuid` instead.
    {
      table: "cross_store_settlement_items",
      kind: "or_two_columns",
      column_a: "store_uuid",
      column_b: "target_store_uuid",
    },
    {
      table: "cross_store_settlements",
      kind: "or_two_columns",
      column_a: "from_store_uuid",
      column_b: "to_store_uuid",
    },
    // 6. transfer_requests — from/to store columns
    {
      table: "transfer_requests",
      kind: "or_two_columns",
      column_a: "from_store_uuid",
      column_b: "to_store_uuid",
    },
    // 7. operating_days, rooms, hostesses, managers
    { table: "store_operating_days", kind: "store_scoped" },
    { table: "rooms", kind: "store_scoped" },
    { table: "hostesses", kind: "store_scoped" },
    { table: "managers", kind: "store_scoped" },
    // 8. store_memberships — store_uuid OR profile_id
    {
      table: "store_memberships",
      kind: "store_scoped_with_actor",
      actor_column: "profile_id",
    },
    // 9. store_service_types, store_settings
    { table: "store_service_types", kind: "store_scoped" },
    { table: "store_settings", kind: "store_scoped" },
    // 10. stores
    {
      table: "stores",
      kind: "id_in_list",
      column: "id",
      ids: testStoreUuids,
    },
    // 11. profiles
    {
      table: "profiles",
      kind: "id_in_list",
      column: "id",
      ids: testUserIds,
    },
  ]
}

async function countRecipe(
  supabase: SupabaseClient,
  recipe: Recipe,
  testStoreUuids: string[],
  testUserIds: string[],
): Promise<number> {
  // SAFETY: if the relevant id-list is empty, return 0 — never run an
  // unbounded SELECT/DELETE.
  if (recipe.kind === "id_in_list" && recipe.ids.length === 0) return 0
  if (
    recipe.kind === "store_scoped" &&
    testStoreUuids.length === 0
  ) {
    return 0
  }
  if (recipe.kind === "store_scoped_with_actor") {
    if (testStoreUuids.length === 0 && testUserIds.length === 0) return 0
  }

  let q = supabase.from(recipe.table).select("id", { count: "exact", head: true })
  if (recipe.kind === "store_scoped") {
    q = q.in("store_uuid", testStoreUuids)
  } else if (recipe.kind === "store_scoped_with_actor") {
    if (testStoreUuids.length > 0 && testUserIds.length > 0) {
      q = q.or(
        `store_uuid.in.(${testStoreUuids.join(",")}),${recipe.actor_column}.in.(${testUserIds.join(",")})`,
      )
    } else if (testStoreUuids.length > 0) {
      q = q.in("store_uuid", testStoreUuids)
    } else {
      q = q.in(recipe.actor_column, testUserIds)
    }
  } else if (recipe.kind === "or_two_columns") {
    q = q.or(
      `${recipe.column_a}.in.(${testStoreUuids.join(",")}),${recipe.column_b}.in.(${testStoreUuids.join(",")})`,
    )
  } else if (recipe.kind === "id_in_list") {
    q = q.in(recipe.column, recipe.ids)
  }
  const { count, error } = await q
  if (error) {
    warn(`count ${recipe.table} failed: ${error.message}`)
    return 0
  }
  return count ?? 0
}

async function applyRecipe(
  supabase: SupabaseClient,
  recipe: Recipe,
  testStoreUuids: string[],
  testUserIds: string[],
): Promise<number> {
  if (recipe.kind === "id_in_list" && recipe.ids.length === 0) return 0
  if (
    recipe.kind === "store_scoped" &&
    testStoreUuids.length === 0
  ) {
    return 0
  }
  if (recipe.kind === "store_scoped_with_actor") {
    if (testStoreUuids.length === 0 && testUserIds.length === 0) return 0
  }

  let q = supabase.from(recipe.table).delete({ count: "exact" })
  if (recipe.kind === "store_scoped") {
    q = q.in("store_uuid", testStoreUuids)
  } else if (recipe.kind === "store_scoped_with_actor") {
    if (testStoreUuids.length > 0 && testUserIds.length > 0) {
      q = q.or(
        `store_uuid.in.(${testStoreUuids.join(",")}),${recipe.actor_column}.in.(${testUserIds.join(",")})`,
      )
    } else if (testStoreUuids.length > 0) {
      q = q.in("store_uuid", testStoreUuids)
    } else {
      q = q.in(recipe.actor_column, testUserIds)
    }
  } else if (recipe.kind === "or_two_columns") {
    q = q.or(
      `${recipe.column_a}.in.(${testStoreUuids.join(",")}),${recipe.column_b}.in.(${testStoreUuids.join(",")})`,
    )
  } else if (recipe.kind === "id_in_list") {
    q = q.in(recipe.column, recipe.ids)
  }
  const { count, error } = await q
  if (error) {
    warn(`delete ${recipe.table} failed: ${error.message}`)
    return 0
  }
  return count ?? 0
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  log(`SUPABASE_URL = ${SUPABASE_URL}`)
  log(`mode = ${CONFIRM ? "CONFIRM (will delete)" : "dry-run (preview only)"}`)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Resolve test store ids that actually exist (intersect with constants).
  const { data: presentStores, error: storeErr } = await supabase
    .from("stores")
    .select("id, store_name, store_code")
    .in("id", TEST_STORE_UUIDS as readonly string[] as string[])
  if (storeErr) {
    console.error("[cleanup] cannot read stores:", storeErr.message)
    process.exit(1)
  }
  const testStoreUuids = (presentStores ?? []).map((r) => r.id as string)
  for (const s of presentStores ?? []) {
    log(
      `test store present: ${s.store_code} ${s.id} (${s.store_name})`,
    )
  }
  if (testStoreUuids.length === 0) {
    log("no test stores present in DB.")
  }

  // ── Resolve test auth user ids.
  let testUserIds: string[] = []
  try {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
    if (listErr) throw new Error(listErr.message)
    testUserIds = list.users
      .filter((u) => u.email && u.email.endsWith(TEST_EMAIL_DOMAIN))
      .map((u) => u.id)
    log(`test auth users: ${testUserIds.length} (${TEST_EMAIL_DOMAIN})`)
  } catch (e) {
    warn(`auth listUsers failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (testStoreUuids.length === 0 && testUserIds.length === 0) {
    log("Nothing to clean up. Exiting.")
    return
  }

  // ── SAFETY ASSERT: every store_uuid we'll touch is in the constant list.
  for (const id of testStoreUuids) {
    if (!(TEST_STORE_UUIDS as readonly string[]).includes(id)) {
      console.error(
        `[cleanup] ABORT: resolved a store_uuid not in TEST_STORE_UUIDS: ${id}. Refusing to proceed.`,
      )
      process.exit(1)
    }
  }

  const recipes = buildRecipes(testStoreUuids, testUserIds)

  // ── Phase 1: dry-run preview (always) ──────────────────────────
  log("─── DRY-RUN COUNTS ───")
  let totalRows = 0
  for (const r of recipes) {
    const c = await countRecipe(supabase, r, testStoreUuids, testUserIds)
    if (c > 0) {
      log(`  ${r.table}: ${c} rows`)
      totalRows += c
    }
  }
  log(`  total rows to delete: ${totalRows}`)
  log(`  auth users to delete: ${testUserIds.length}`)

  if (!CONFIRM) {
    log("dry-run complete. Pass --confirm to actually delete.")
    return
  }

  // ── Phase 2: apply deletes (in order) ──────────────────────────
  log("─── APPLYING DELETES ───")
  let totalDeleted = 0
  for (const r of recipes) {
    const c = await applyRecipe(supabase, r, testStoreUuids, testUserIds)
    if (c > 0) {
      log(`  ${r.table}: deleted ${c}`)
      totalDeleted += c
    }
  }
  log(`  total rows deleted: ${totalDeleted}`)

  // ── Phase 3: auth users ────────────────────────────────────────
  let authDeleted = 0
  for (const uid of testUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(uid)
    if (error) {
      warn(`auth deleteUser(${uid}) failed: ${error.message}`)
    } else {
      authDeleted++
    }
  }
  log(`  auth users deleted: ${authDeleted}/${testUserIds.length}`)

  log("cleanup: DONE.")
}

main().catch((e) => {
  console.error("[cleanup] FATAL", e)
  process.exit(1)
})
