/** apply 095_waitlist_requests + 096_room_service_calls migrations */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

for (const f of ["database/095_waitlist_requests.sql", "database/096_room_service_calls.sql"]) {
  const sql = readFileSync(f, "utf8")
  let error
  try { const r = await sb.rpc("exec_sql", { sql }); error = r.error }
  catch (e) { error = e }
  console.log(`${f}:`, error ? `❌ ${error.message ?? error}` : "✓ applied")
}

// verify
for (const t of ["waitlist_requests", "room_service_calls"]) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true })
  console.log(`  ${t}: ${error ? `❌ ${error.message}` : `count=${count}`}`)
}
