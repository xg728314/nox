/** 중복 매장 9개 (rooms=0 · sess=0 · parts=0) soft-disable */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DUPS = [
  ["d47134c5-813f-42f8-ae9c-c09ece9aca59", "6F 아우라"],
  ["fe45ed5e-39dd-4607-a9cc-430bdfbb9d5f", "6F 신세계"],
  ["2544378e-f014-41b9-b8a6-b85c80e630bd", "6F 아지트"],
  ["6d62cdfe-cf09-48d6-ba77-b02dc05475cb", "6F 퍼스트"],
  ["fea44d3e-fa33-4080-abb7-3b6fc84f9e1a", "7F 상한가"],
  ["2e382c89-7439-4080-b0c4-ee07276cd8be", "7F 토끼"],
  ["de95f6d9-2140-4909-af33-5111a68c1dec", "7F 발리"],
  ["0f0417d8-5265-4f0b-b249-65b3c1ed3fc0", "7F 두바이"],
  ["c4bbf97e-90bd-496e-a5c0-1b094ac94c3e", "8F 파티"],
]

for (const [id, label] of DUPS) {
  // Safety re-check: rooms/sess/parts 0 확인
  const [r, s, p] = await Promise.all([
    sb.from("rooms").select("id", { count: "exact", head: true }).eq("store_uuid", id).then(x => x.count),
    sb.from("room_sessions").select("id", { count: "exact", head: true }).eq("store_uuid", id).then(x => x.count),
    sb.from("session_participants").select("id", { count: "exact", head: true }).eq("store_uuid", id).then(x => x.count),
  ])
  if ((r ?? 0) > 0 || (s ?? 0) > 0 || (p ?? 0) > 0) {
    console.log(`⚠ SKIP ${label} · rooms=${r} sess=${s} parts=${p} (안전하지 않음)`)
    continue
  }
  const { error } = await sb.from("stores").update({ is_active: false }).eq("id", id)
  console.log(error ? `❌ ${label}: ${error.message}` : `✅ ${label} · is_active=false`)
}
console.log("\n중복 매장 disable 완료")
