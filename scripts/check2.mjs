import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// find 테스트실장 manager
const { data: prof } = await sb.from("profiles").select("id").eq("full_name", "테스트실장").maybeSingle()
const { data: mems } = await sb.from("store_memberships")
  .select("id, status, deleted_at").eq("profile_id", prof.id).eq("role", "manager")
console.log("manager memberships:", JSON.stringify(mems, null, 2))

if (mems && mems[0]) {
  const mid = mems[0].id
  // 1) try status=revoked
  const { data: r1, error: e1 } = await sb.from("store_memberships")
    .update({ status: "revoked" }).eq("id", mid).select()
  console.log("\n[TEST 1] status=revoked:", e1?.message ?? "OK", "affected=" + (r1?.length ?? 0))
  // 2) try status=suspended
  const { data: r2, error: e2 } = await sb.from("store_memberships")
    .update({ status: "suspended" }).eq("id", mid).select()
  console.log("[TEST 2] status=suspended:", e2?.message ?? "OK", "affected=" + (r2?.length ?? 0))
  // 3) revert
  await sb.from("store_memberships").update({ status: "approved" }).eq("id", mid)
  console.log("[CLEANUP] reverted to approved")
}
