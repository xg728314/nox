import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"
const cases = [
  "마 2번방 지연 수연 미연 셔 완메",
  "마 지연 퍼 완메",
  "1번방 마 지연 셔",
  "마블 3호실 지연 셔 완메",
]
for (const c of cases) {
  console.log(`\n=== '${c}' ===`)
  const r = parseStaffChat(c)
  for (const e of r.entries) {
    console.log(`  room=${e.room_no ?? "-"} store=${e.origin_store_name ?? "-"} name=${e.name ?? "?"} cat=${e.category ?? "-"} ticket=${e.ticket_type ?? "-"}`)
  }
}
