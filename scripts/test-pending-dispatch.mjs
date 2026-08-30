/**
 * R-pending-pool (2026-08-31): pending mode 재현.
 *   기존 test-cross-store-dispatch.mjs (immediate) 와 달리 transfer_request 만 생성.
 *   Marvel 사장 앱 조판 홈 상단에 「🚪 도착 대기 N」 배지 뜸.
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(
  envRaw.split("\n").filter(l => l.includes("=")).map(l => {
    const [k, ...rest] = l.split("=")
    return [k.trim(), rest.join("=").trim()]
  })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Marvel 매장
const { data: marvel } = await sb.from("stores").select("id, store_name, floor").eq("store_name", "마블").maybeSingle()
console.log(`Marvel: ${marvel.id} · floor ${marvel.floor}`)

// 7층 비-Marvel origin (발리)
const { data: origins } = await sb.from("stores").select("id, store_name, floor").eq("is_active", true).neq("id", marvel.id).eq("floor", 7)
const origin = origins?.[0]
console.log(`Origin: ${origin.store_name} (${origin.id})`)

// origin 매장의 hostess 2명 (지연 · 지효 or 랜덤 2명)
const { data: hostRows } = await sb
  .from("store_memberships")
  .select("id, profile_id")
  .eq("store_uuid", origin.id).eq("role", "hostess").eq("status", "approved").is("deleted_at", null)
  .limit(20)
const mids = hostRows.map(h => h.id)
const { data: hnames } = await sb.from("hostesses").select("membership_id, name").in("membership_id", mids)
const nameByMid = new Map((hnames ?? []).map(h => [h.membership_id, h.name]))

// 이름 있고 active 아닌 hostess 2명 선택
const { data: activePs } = await sb
  .from("session_participants").select("membership_id").in("membership_id", mids).eq("status", "active").is("deleted_at", null)
const activeSet = new Set((activePs ?? []).map(p => p.membership_id))
const candidates = hostRows.filter(h => nameByMid.get(h.id) && !activeSet.has(h.id)).slice(0, 2)
if (candidates.length === 0) { console.error("candidates 0"); process.exit(1) }
console.log(`테스트 아가씨: ${candidates.map(c => nameByMid.get(c.id)).join(", ")}`)

// Marvel 오늘 business_day (getBusinessDateForOps 흉내 — KST 06:00 cutoff)
const now = new Date()
const kstMs = now.getTime() + 9 * 60 * 60 * 1000
const kst = new Date(kstMs)
// KST 시간이 06:00 이전이면 어제
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0, 10)
console.log(`Business date (KST, ops): ${businessDate}`)

let bizDayId
const { data: bd } = await sb.from("store_operating_days").select("id, status")
  .eq("store_uuid", marvel.id).eq("business_date", businessDate).maybeSingle()
if (bd) {
  bizDayId = bd.id
  if (bd.status === "closed") await sb.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", bd.id)
  console.log(`  reuse bizDay ${bizDayId}`)
} else {
  const { data: newBd } = await sb.from("store_operating_days")
    .insert({ store_uuid: marvel.id, business_date: businessDate, status: "open", opened_by: candidates[0].profile_id })
    .select("id").single()
  bizDayId = newBd.id
  console.log(`  new bizDay ${bizDayId}`)
}

// transfer_request insert (pending pool 등록) — metadata JSON in reason
const nowIso = new Date().toISOString()
const created = []
for (const c of candidates) {
  const meta = { category: "퍼블릭", time_type: "기본", dispatched_by: null, dispatched_at: nowIso }
  const { data: tr, error } = await sb.from("transfer_requests").insert({
    hostess_membership_id: c.id,
    from_store_uuid: origin.id,
    to_store_uuid: marvel.id,
    business_day_id: bizDayId,
    status: "approved",
    from_store_approved_by: c.profile_id,
    from_store_approved_at: nowIso,
    to_store_approved_by: c.profile_id,
    to_store_approved_at: nowIso,
    reason: JSON.stringify(meta),
  }).select("id").single()
  if (error) { console.error(`insert failed for ${nameByMid.get(c.id)}: ${error.message}`); continue }
  created.push({ id: tr.id, name: nameByMid.get(c.id) })
  console.log(`  ✓ pending transfer ${tr.id} · ${nameByMid.get(c.id)}`)
}

console.log(`\n===`)
console.log(`Marvel 조준성 앱 → 조판 홈 상단에 「🚪 도착 대기 ${created.length}」 배지 (amber pulse)`)
console.log(`배지 클릭 → 시트 → ${created.map(c => c.name).join(", ")} 목록`)
console.log(`각 아가씨 카드 클릭 → 방 grid → 방 pick → 정식 등록 (session_participant 생성)`)
console.log(`정리: node scripts/test-pending-cleanup.mjs (아래 id 로 삭제)`)
console.log(created.map(c => `  transfer_request_id: ${c.id}`).join("\n"))
