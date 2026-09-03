/** Marvel 소속 (또는 origin=Marvel) hostesses 중 동명이인 detect */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

const { data: hostsA } = await sb.from("hostesses")
  .select("membership_id, name, store_uuid, origin_store_uuid, created_at")
  .eq("store_uuid", MARVEL)
const { data: hostsB } = await sb.from("hostesses")
  .select("membership_id, name, store_uuid, origin_store_uuid, created_at")
  .eq("origin_store_uuid", MARVEL)
const merged = new Map()
for (const h of (hostsA ?? [])) merged.set(h.membership_id, h)
for (const h of (hostsB ?? [])) merged.set(h.membership_id, h)
const hosts = [...merged.values()]

const byName = new Map()
for (const h of hosts) {
  if (!byName.has(h.name)) byName.set(h.name, [])
  byName.get(h.name).push(h)
}

const dups = [...byName.entries()].filter(([, arr]) => arr.length > 1).sort((a, b) => b[1].length - a[1].length)
console.log(`Marvel 관련 hostesses ${hosts.length}건`)
console.log(`동명이인 그룹: ${dups.length}개\n`)

let totalRedundant = 0
for (const [name, arr] of dups.slice(0, 15)) {
  console.log(`── ${name} · ${arr.length}명 ──`)
  for (const h of arr) {
    const { count: pCount } = await sb.from("session_participants")
      .select("id", { count: "exact", head: true }).eq("membership_id", h.membership_id)
    console.log(`  mid=${h.membership_id.slice(0,8)} · created ${h.created_at?.slice(0,10)} · 참여 ${pCount}건`)
  }
  totalRedundant += arr.length - 1
}

console.log(`\n중복으로 제거 가능한 hostesses: ${totalRedundant}건`)
