import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

const cases = [
  // A. 매장 이름 변형
  ["A1", "1t 마 지연 셔 완메"],
  ["A2", "1t 지연 셔 완메"],
  ["A3", "1t 8번가 지연 셔 완메"],
  ["A4", "1t 신 지수 퍼 완메"],
  ["A5", "1t 신세계 지수 퍼 완메"],
  // B. 방번호 변형
  ["B1", "1번방 마 지연 셔 완메"],
  ["B2", "마 3호실 지연 셔 완메"],
  ["B3", "마 지연 5번방 셔 완메"],
  ["B4", "마 R7 지연 셔"],
  // C. 그룹핑
  ["C1", "1t 마 수영 화영 퍼 지연 셔 완메"],
  ["C2", "1t 마 수영 퍼 완메 화영 셔 반티"],
  ["C3", "마 지연 수연 미연 퍼 완메"],
  // D. 실수 케이스
  ["D1", "1t   마   지연   셔   완메"],
  ["D2", "1T 마 지연 셔 완메"],
  ["D3", "1번방마지연셔완메"],
  ["D4", "1t 마 지연연 셔 완메"],  // 이름 오타
  ["D5", "1t 마 지연 셔 완티"],    // 티켓 풀네임
  ["D6", "1t 마, 지연 셔 완메"],   // 쉼표
  // E. Cross-store
  ["E1", "1t 마 지연 퍼 신 지수 셔 완메"],
  ["E2", "1t 마 지연 라 수영 두 은지 퍼 완메"],
  // F. 노이즈
  ["F1", "안녕하세요 1t 마 지연 셔 완메"],
  ["F2", "1t 마 지연 셔 완메 잘부탁드려요"],
  ["F3", "1t 마 지연 셔 완메 !!!!"],
  // G. 티켓 다양
  ["G1", "1t 마 지연 셔 반티"],
  ["G2", "1t 마 지연 셔 반차3"],
  ["G3", "1t 마 지연 셔 차3"],
  // H. 방번호 없음
  ["H1", "마 지연 셔 완메"],
  ["H2", "지연 셔 완메"],
  // I. 오탈자 이름
  ["I1", "1t 마 지연 지언 셔 완메"],
  ["I2", "1t 마 미연 미언 셔 완메"],
]

let pass = 0, fail = []
for (const [id, text] of cases) {
  const r = parseStaffChat(text)
  const cnt = r.entries.length
  const first = r.entries[0]
  const ok = cnt > 0 && first?.name && first?.category && first?.ticket_type
  if (ok) pass++
  else fail.push({ id, text, cnt, warnings: r.warnings.slice(0,2) })
  const summary = r.entries.map(e => `${e.origin_store_name??"본매장"}·${e.name}·${e.category??"-"}·${e.ticket_type??"-"}·room=${e.room_no??"-"}`).join(" | ")
  console.log(`${ok?"✓":"✗"} [${id}] '${text}'`)
  console.log(`   → ${summary || "(파싱실패)"}`)
}
console.log(`\n=== ${pass}/${cases.length} pass ===`)
if (fail.length > 0) {
  console.log("FAILS:")
  for (const f of fail) console.log(` [${f.id}] '${f.text}' · cnt=${f.cnt} · warns=${f.warnings.join("|")}`)
}
