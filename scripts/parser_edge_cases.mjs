import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

const edges = [
  // 매장명 없음 (본매장 fallback)
  ["1번방 지연 셔 완메",                    { store: null,   room:"1", name:"지연" }],
  ["지연 셔 완메",                          { store: null,   room:null,name:"지연" }],
  // 매장 축약 + 이름 뒤 방번호
  ["마 지연 2번방 셔 완메",                { store:"마블",  room:"2", name:"지연" }],
  // 매장 완전형
  ["8번가 지연 셔 완메",                   { store:"8번가", room:null,name:"지연" }],
  // 여러 매장 mixed (parser 지원 여부)
  ["마 지연 라 수영 셔 완메",              { store:"multi" }],
  // 룸번호 다양한 표기
  ["마 5T 지연 셔",                        { store:"마블",  room:"5" }],
  ["마 3호실 지연 셔",                     { store:"마블",  room:"3" }],
  ["마 R7 지연 셔",                        { store:"마블",  room:"7" }],
  // 오탈자 이름 매칭 (parser 는 raw 리턴만)
  ["마 지언 셔 완메",                      { store:"마블",  name:"지언" }],
  // 카테고리만
  ["마 지연 셔",                           { store:"마블",  name:"지연", cat:"셔츠" }],
  // 잘못된 입력
  ["잘못된 문장",                          { store: null,   name:"?" }],
  ["",                                     { empty: true }],
  ["마",                                   { empty: true }],
  // 실제 실장 흔한 오탈자
  ["ㅁ 지연 셔",                           { fail: true }],
  // 큰 그룹 · 이름 8명
  ["마 지연 수연 미연 은지 화영 채아 예린 유나 퍼 완메", { store:"마블", count:8 }],
]

for (const [input, exp] of edges) {
  const r = parseStaffChat(input)
  const desc = r.entries.length === 0
    ? `(empty · warnings=${r.warnings.length})`
    : r.entries.map(e => `store=${e.origin_store_name??"?"} room=${e.room_no??"-"} name=${e.name} cat=${e.category??"-"} tk=${e.ticket_type??"-"}`).join(" | ")
  console.log(`'${input || "(empty)"}'\n  → ${desc}`)
}
