/** check whether 테스트실장 revoke actually persisted */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// find test실장 memberships
const { data: profs } = await sb.from("profiles").select("id, full_name, phone").ilike("full_name", "%테스트%")
console.log("=== 테스트 프로필들 ===")
for (const p of profs ?? []) console.log(" ", p.id, "|", p.full_name, "|", p.phone)

const profIds = (profs ?? []).map(p => p.id)
if (profIds.length === 0) { console.log("no matching profiles"); process.exit(0) }

const { data: mems } = await sb.from("store_memberships")
  .select("id, profile_id, store_uuid, role, status, deleted_at, permissions, updated_at")
  .in("profile_id", profIds)
  .in("role", ["owner", "manager"])
  .order("updated_at", { ascending: false })

console.log("\n=== memberships ===")
for (const m of mems ?? []) {
  const p = profs.find(x => x.id === m.profile_id)
  console.log(
    " ", m.id.slice(0,8),
    "|", p?.full_name,
    "|", m.role,
    "| status=" + m.status,
    "| deleted=" + (m.deleted_at ? "YES(" + m.deleted_at.slice(0,19) + ")" : "no"),
    "| perms=" + (m.permissions ? Object.keys(m.permissions).filter(k => m.permissions[k]).length + "개" : "NULL"),
    "| updated=" + m.updated_at?.slice(0,19),
  )
}
