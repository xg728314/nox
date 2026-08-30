import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const { data: mems } = await sb.from("store_memberships")
  .select("id, role, status, profile_id, profiles!store_memberships_profile_id_fkey(full_name)")
  .eq("store_uuid", MARVEL).in("role", ["owner","manager"]).eq("status", "approved").is("deleted_at", null)
for (const m of (mems ?? [])) {
  const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
  console.log(`${m.role.padEnd(8)} · ${p?.full_name ?? "?"} · ${m.id}`)
}
