import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const mid = "7587f08a" // prefix

const { data: audit } = await sb.from("audit_events")
  .select("id, action, entity_table, entity_id, before, after, created_at, actor_membership_id")
  .eq("entity_table", "store_memberships")
  .ilike("entity_id", `${mid}%`)
  .order("created_at", { ascending: false })
  .limit(10)

console.log("=== audit events for membership 7587f08a ===")
for (const e of audit ?? []) {
  console.log(" ", e.created_at.slice(0,19), "|", e.action, "| before=" + JSON.stringify(e.before), "| after=" + JSON.stringify(e.after))
}

// also check for recent 'manager_' audit events across store
const { data: recent } = await sb.from("audit_events")
  .select("id, action, entity_id, created_at")
  .ilike("action", "manager_%")
  .order("created_at", { ascending: false })
  .limit(10)
console.log("\n=== recent manager_* audit events ===")
for (const e of recent ?? []) {
  console.log(" ", e.created_at.slice(0,19), "|", e.action, "|", e.entity_id.slice(0,8))
}
