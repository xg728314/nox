import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"
const stores = [
  ["라이브", "라"], ["마블", "마"], ["버닝", "버"], ["황진이", "황"],
  ["신세계", "신"], ["아우라", "아우"], ["아지트", "아지"], ["퍼스트", "퍼스"],
  ["두바이", "두"], ["발리", "발"], ["상한가", "상"], ["토끼", "토"],
  ["8번가", "8번가"], ["썸", "썸"], ["파티", "파"],
]
console.log("=== 전체 매장 · 축약형 + 완전형 · 룸번호 없음 ===")
for (const [full, short] of stores) {
  for (const label of [full, short]) {
    const input = `${label} 지연 셔 완메`
    const r = parseStaffChat(input)
    const e = r.entries[0]
    const status = e?.origin_store_name === full ? "✓" : "✗"
    console.log(`  ${status} '${input}' → store=${e?.origin_store_name ?? "-"} name=${e?.name ?? "-"}`)
  }
}

console.log("\n=== 매장+2번방 조합 ===")
for (const [full, short] of stores) {
  const input = `${short} 2번방 지연 셔 완메`
  const r = parseStaffChat(input)
  const e = r.entries[0]
  const ok = e?.room_no === "2" && e?.origin_store_name === full
  const status = ok ? "✓" : "✗"
  console.log(`  ${status} '${input}' → room=${e?.room_no ?? "-"} store=${e?.origin_store_name ?? "-"}`)
}
