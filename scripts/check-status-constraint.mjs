import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data, error } = await sb.rpc("exec_sql", {
  sql: `SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'store_memberships'::regclass AND contype = 'c'`
})
console.log("constraints:", error ? "err:" + error.message : JSON.stringify(data, null, 2))

// try a direct update and see what error comes back
const { error: updErr } = await sb.from("store_memberships")
  .update({ status: "revoked" })
  .eq("id", "7587f08a-0000-0000-0000-000000000000") // fake to avoid mutation
console.log("update err:", updErr?.message ?? "none")

// try with real id
const testId = "7587f08a-b978-c73e-0000-000000000000"
const { data: realData } = await sb.from("store_memberships").select("id").ilike("id", "7587f08a%").maybeSingle()
if (realData) {
  const { error: e2 } = await sb.from("store_memberships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", realData.id)
  console.log("update deleted_at only:", e2?.message ?? "OK")
  // revert
  await sb.from("store_memberships").update({ deleted_at: null }).eq("id", realData.id)
}
