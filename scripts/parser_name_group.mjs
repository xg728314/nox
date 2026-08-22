import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"
const cases = [
  "수영 화영 퍼 지연 셔 완메",
  "수영 화영 퍼 완메 수영 셔 반차3 메",
  "1t 수영 화영 퍼 지연 셔 완메",
  "마 2번방 지연 셔 완메",
  "마 지연 퍼 완메",
]
for (const c of cases) {
  console.log(`\n=== '${c}' ===`)
  const r = parseStaffChat(c)
  for (const e of r.entries) {
    console.log(`  room=${e.room_no ?? "-"} store=${e.origin_store_name ?? "(본매장)"} name=${e.name} cat=${e.category ?? "-"} ticket=${e.ticket_type ?? "-"}`)
  }
}
