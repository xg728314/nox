/** 매장 중복 조사 — 각 duplicate 매장의 실사용 여부 (rooms, memberships, sessions) 확인. */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: stores } = await sb.from("stores").select("id, store_name, floor, is_active, created_at").eq("is_active", true).order("floor")
const groups = new Map()
for (const s of stores) {
  const k = `${s.floor}|${s.store_name}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(s)
}

const dups = [...groups.entries()].filter(([, arr]) => arr.length > 1)
console.log(`중복 매장 그룹: ${dups.length}개\n`)

for (const [key, arr] of dups) {
  const [floor, name] = key.split("|")
  console.log(`─── ${floor}F ${name} (${arr.length}개) ───`)
  for (const s of arr) {
    const [roomCnt, memCnt, sessCnt, partCnt] = await Promise.all([
      sb.from("rooms").select("id", { count: "exact", head: true }).eq("store_uuid", s.id).then(r => r.count),
      sb.from("store_memberships").select("id", { count: "exact", head: true }).eq("store_uuid", s.id).is("deleted_at", null).then(r => r.count),
      sb.from("room_sessions").select("id", { count: "exact", head: true }).eq("store_uuid", s.id).then(r => r.count),
      sb.from("session_participants").select("id", { count: "exact", head: true }).eq("store_uuid", s.id).then(r => r.count),
    ])
    const created = new Date(s.created_at).toISOString().slice(0, 10)
    console.log(`  ${s.id.slice(0,8)}... · rooms=${roomCnt} · mem=${memCnt} · sess=${sessCnt} · parts=${partCnt} · 생성=${created}`)
  }
  console.log()
}

console.log(`권장: 사용 지표 (mem/sess/parts) 0 인 매장을 stores.is_active=false 로 soft-disable`)
console.log(`     (rooms 나 다른 참조가 있으면 hard delete 대신 disable · UI 노출 차단)`)
