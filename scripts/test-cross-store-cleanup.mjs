/**
 * test-cross-store-dispatch.mjs 로 삽입한 테스트 데이터 정리.
 * 실행: node scripts/test-cross-store-cleanup.mjs
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

const PARTICIPANT_ID = "9d6381d6-bfca-4fa2-a44b-d7a0707eebbb"
const SESSION_ID = "180dcf29-abaf-4c45-b38a-3ee3e2d8613b"
const TRANSFER_REQUEST_ID = "8de62198-2a2f-4410-806a-3c514a9340c3"

// 방이동 테스트 후 참여자가 다른 세션으로 옮겨졌을 수 있음 → 실제 session_id 확인
const { data: partNow } = await sb
  .from("session_participants")
  .select("id, session_id")
  .eq("id", PARTICIPANT_ID)
  .maybeSingle()

const activeSessionId = partNow?.session_id ?? SESSION_ID

// 1. participant 삭제
const { error: pErr } = await sb.from("session_participants").delete().eq("id", PARTICIPANT_ID)
console.log(pErr ? `participant delete failed: ${pErr.message}` : `✓ participant ${PARTICIPANT_ID} 삭제`)

// 2. 원 세션 + (이동한 경우) 새 세션 모두 정리
const sessionsToCheck = [...new Set([SESSION_ID, activeSessionId])]
for (const sid of sessionsToCheck) {
  const { count } = await sb
    .from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sid)
    .eq("status", "active")
  if ((count ?? 0) === 0) {
    const { error: sErr } = await sb.from("room_sessions").delete().eq("id", sid)
    console.log(sErr ? `session ${sid} delete failed: ${sErr.message}` : `✓ session ${sid} 삭제 (참여자 0명)`)
  } else {
    console.log(`- session ${sid} 유지 (다른 참여자 ${count}명)`)
  }
}

// 3. transfer_request 삭제
const { error: tErr } = await sb.from("transfer_requests").delete().eq("id", TRANSFER_REQUEST_ID)
console.log(tErr ? `transfer_request delete failed: ${tErr.message}` : `✓ transfer_request ${TRANSFER_REQUEST_ID} 삭제`)

console.log("\n정리 완료.")
