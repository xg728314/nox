import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

const cases = [
  // 도메인 blacklist 검증
  ["1번방 김사장님 지연 셔 완메",        "김사장님 skip · 지연만"],
  ["초이스 20명 봤어 지연 셔 완메",       "초이스/봤어 skip · 지연만"],
  ["1번방 손님 5명 지연 셔 완메",         "손님/5명 skip · 지연만"],
  ["박이사님 지연 셔 완메",              "박이사님 skip"],

  // 종료 이벤트
  ["지연 팅",                             "checkout event"],
  ["지연 나감",                           "checkout event"],
  ["지연 종료",                           "checkout event"],
  ["지연 끝",                             "checkout event"],
  ["1번방 지연 아웃",                     "checkout event · room"],

  // 정상 (회귀)
  ["1번방 지연 셔 완메",                  "정상"],
  ["1t 마 수영 화영 퍼 지연 셔 완메",     "그룹핑 정상"],
]

for (const [text, desc] of cases) {
  const r = parseStaffChat(text)
  const entries = r.entries.map(e => `${e.name}·${e.category??"-"}·${e.ticket_type??"-"}`).join(" | ") || "(empty)"
  const event = r.entries[0]?.event ?? "-"
  const warns = r.warnings.length > 0 ? r.warnings.map(w=>w.replace(/^\d+행: /, "")).join(";") : ""
  console.log(`'${text}'`)
  console.log(`  [${desc}] → entries: ${entries} · event=${event}`)
  if (warns) console.log(`  warnings: ${warns}`)
}
