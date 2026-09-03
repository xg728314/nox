import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 1. chat_participants 스키마 (membership_id 컬럼 존재?)
const { data: cp, error: cpErr } = await sb.from("chat_participants").select("*").limit(1)
console.log("chat_participants sample row keys:", cp?.[0] ? Object.keys(cp[0]) : "NO ROWS")
if (cpErr) console.log("err:", cpErr.message)

// 2. audit_events 최근 manager_permissions_updated 확인
const { data: aud } = await sb.from("audit_events")
  .select("action, entity_id, after, created_at")
  .eq("action", "manager_permissions_updated")
  .order("created_at", { ascending: false }).limit(5)
console.log("\nrecent manager_permissions_updated:")
for (const a of aud ?? []) console.log(" ", a.created_at.slice(0,19), "|", a.entity_id.slice(0,8), "| after=" + JSON.stringify(a.after))
