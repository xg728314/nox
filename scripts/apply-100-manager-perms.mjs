/** apply 100_manager_permissions migration */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const sql = readFileSync("database/100_manager_permissions.sql", "utf8")
let error
try { const r = await sb.rpc("exec_sql", { sql }); error = r.error }
catch (e) { error = e }
console.log(`database/100_manager_permissions.sql:`, error ? `❌ ${error.message ?? error}` : "✓ applied")

// verify column exists by selecting a row
const { data, error: qErr } = await sb
  .from("store_memberships")
  .select("id, permissions")
  .limit(1)
console.log(`  column check:`, qErr ? `❌ ${qErr.message}` : `✓ permissions column readable (${data?.length ?? 0} row)`)
