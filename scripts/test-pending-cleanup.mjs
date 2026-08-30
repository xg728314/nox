/**
 * pending pool + 이전 immediate 테스트 데이터 정리.
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

// R-pending-pool 테스트 (2026-08-31 · 최신 재생성)
const PENDING_TRS = [
  "d1137c41-66f9-4632-a09c-24f074ec6931", // 채아
  "3ff81044-4c5a-418b-beda-8ed929a87ec0", // 지유
]

// 이전 test-cross-store-dispatch.mjs (immediate) 지효 데이터 (이미 삭제됨 · null-safe)
const IMMEDIATE_PART = "9d6381d6-bfca-4fa2-a44b-d7a0707eebbb"
const IMMEDIATE_SESS = "180dcf29-abaf-4c45-b38a-3ee3e2d8613b"
const IMMEDIATE_TR = "8de62198-2a2f-4410-806a-3c514a9340c3"

// E2E 스크립트로 생성한 지유 participant (5번방) — session/participant cascade
const E2E_PARTICIPANT = "c90d3f90"  // prefix 만
const E2E_SESSION = "ee0067ad"      // prefix 만

// 1. pending TRs — 각각 session_participant 생성됐는지 확인 후 삭제
for (const trId of PENDING_TRS) {
  const { data: p } = await sb.from("session_participants").select("id, session_id")
    .eq("transfer_request_id", trId).is("deleted_at", null).maybeSingle()
  if (p) {
    // 방 배정 완료됐음 → participant 먼저 삭제
    await sb.from("session_participants").delete().eq("id", p.id)
    console.log(`✓ participant ${p.id} 삭제 (tr=${trId})`)
    // 그 세션에 다른 active 참여자 없으면 세션도 삭제
    const { count } = await sb.from("session_participants")
      .select("id", { count: "exact", head: true }).eq("session_id", p.session_id).eq("status", "active")
    if ((count ?? 0) === 0) {
      await sb.from("room_sessions").delete().eq("id", p.session_id)
      console.log(`  ✓ session ${p.session_id} 삭제`)
    }
  }
  const { error } = await sb.from("transfer_requests").delete().eq("id", trId)
  console.log(error ? `tr ${trId} delete failed: ${error.message}` : `✓ transfer_request ${trId} 삭제`)
}

// 2. immediate 지효 — 이전 test 데이터
const { data: pImm } = await sb.from("session_participants").select("id, session_id").eq("id", IMMEDIATE_PART).maybeSingle()
if (pImm) {
  const currentSess = pImm.session_id
  await sb.from("session_participants").delete().eq("id", IMMEDIATE_PART)
  console.log(`✓ immediate participant ${IMMEDIATE_PART} 삭제`)
  // 원 세션 or 이동한 세션 정리
  for (const sid of [...new Set([IMMEDIATE_SESS, currentSess])]) {
    const { count } = await sb.from("session_participants")
      .select("id", { count: "exact", head: true }).eq("session_id", sid).eq("status", "active")
    if ((count ?? 0) === 0) {
      await sb.from("room_sessions").delete().eq("id", sid)
      console.log(`  ✓ session ${sid} 삭제`)
    }
  }
}
await sb.from("transfer_requests").delete().eq("id", IMMEDIATE_TR)
console.log(`✓ immediate tr ${IMMEDIATE_TR} 삭제`)

console.log("\n정리 완료.")
