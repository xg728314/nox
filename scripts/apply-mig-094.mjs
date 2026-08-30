/** Apply 094_room_session_lock.sql via service key (one-off). */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(
  envRaw.split("\n").filter(l => l.includes("=")).map(l => {
    const [k, ...rest] = l.split("=")
    return [k.trim(), rest.join("=").trim()]
  })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Supabase JS client doesn't support raw SQL — use rpc if pgexec exists, else exec via query builder.
// Verify by attempting SELECT after ALTER (skip: try direct table alter via db-admin PostgREST).
// Fallback: user runs it in Supabase SQL editor.

const sql = readFileSync("C:/work/nox/database/094_room_session_lock.sql", "utf8")
console.log("Migration SQL:")
console.log(sql)
console.log("\n---")

// Test: is column already there?
const { error: probe } = await sb
  .from("room_sessions")
  .select("locked_by_membership_id, locked_at")
  .limit(1)
if (!probe) {
  console.log("✓ 이미 적용됨 (컬럼 존재)")
  process.exit(0)
}
if (probe.code === "42703") {
  console.log("⚠ 컬럼 미존재 — Supabase SQL 에디터에서 위 SQL 실행 필요")
  console.log("  https://supabase.com/dashboard/project/piboecawkeqahyqbcize/sql/new")
  process.exit(1)
}
console.log("? probe error:", probe)
