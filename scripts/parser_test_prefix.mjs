import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

const cases = [
  "1번방 발 지수 토 은비 버 수지 퍼 완메",
  "마블1번방 발 지수 토 은비 버 수지 퍼 완메",
  "마블 1번방 발 지수 토 은비 버 수지 퍼 완메",
]
for (const c of cases) {
  console.log(`=== '${c}' ===`)
  const r = parseStaffChat(c)
  const summary = (r.entries ?? []).map(e => `room=${e.room_no ?? '-'} store=${e.store ?? '-'} name=${e.name ?? '?'} cat=${e.category ?? '-'} ticket=${e.ticket_type ?? '-'}`)
  console.log(summary.join('\n'))
  console.log("")
}
