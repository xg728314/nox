import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

// 사용자 (마블 사장) 관점:
// 1) "본 매장" 케이스: 매장명 생략 → 마블로 인식되어야 함
// 2) "타 매장 임대" 케이스: 매장명 명시 → 라이브로 인식
console.log("=== 사용자 시나리오 ===\n")

const cases = [
  ["본매장 방번호만", "1번방 지연 셔 완메"],
  ["본매장 방번호 T", "1T 지연 셔 완메"],
  ["본매장 매장명 생략", "지연 셔 완메"],
  ["타매장 라이브 임대", "라이브 1번방 지연 셔 완메"],
  ["타매장 라 축약", "라 1번방 지연 셔 완메"],
  ["타매장 방번호 뒤", "라이브 지연 1번방 셔 완메"],
]

for (const [label, input] of cases) {
  console.log(`[${label}] '${input}'`)
  const r = parseStaffChat(input)
  if (r.entries.length === 0) {
    console.log(`  ⚠ 파싱 실패 · warnings: ${JSON.stringify(r.warnings)}`)
    console.log("")
    continue
  }
  for (const e of r.entries) {
    console.log(`  room=${e.room_no ?? "-"} store=${e.origin_store_name ?? "(본매장?)"} name=${e.name ?? "?"} cat=${e.category ?? "-"} ticket=${e.ticket_type ?? "-"}`)
  }
  console.log("")
}
