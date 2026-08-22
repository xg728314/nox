import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

// 실 실장 채팅 스타일 · 4가지 축을 모든 조합으로 테스트
const ROOM_VARIANTS = ["1t", "1번방", "1번", "1티", "3호실", "5번룸"]
const STORE_VARIANTS = [
  ["", "본매장"], ["마", "마블"], ["마블", "마블"],
  ["신", "신세계"], ["신세계", "신세계"], ["8번가", "8번가"],
]
const CAT_VARIANTS = [["퍼", "퍼블릭"], ["셔", "셔츠"], ["하", "하퍼"]]
const TICKET_VARIANTS = [
  ["완메", "완티"], ["완티", "완티"], ["메이드", "완티"],
  ["반티", "반티"], ["반메", "반티"],
  ["차3", "차3"],
  ["반차3", "반차3"], ["반3", "반차3"], ["ㅂ3", "반차3"],
]

const cases = []

// A. 룸 표기 × 매장 × 카테고리 × 티켓 · 단일 이름 "지수"
for (const room of ROOM_VARIANTS) {
  for (const [st, stFull] of STORE_VARIANTS) {
    for (const [c, cFull] of CAT_VARIANTS) {
      for (const [tk, tkFull] of TICKET_VARIANTS) {
        const text = [room, st, "지수", c, tk].filter(Boolean).join(" ")
        cases.push({ text, expect: { room: room.replace(/[^0-9]/g, ""), store: stFull, cat: cFull, tk: tkFull, count: 1 } })
      }
    }
  }
}

// B. 이름 그룹핑 · "1번방 지수 은빈 효미 퍼 효리 셔 반차3 메이드"
const GROUPINGS = [
  ["1번방 지수 은빈 효미 퍼 효리 셔 반차3 메이드", 4],
  ["1t 마 수영 화영 퍼 지연 셔 완메", 3],
  ["1번 지연 미연 은지 셔 완메", 3],
  ["2번방 마 하늘 하퍼 반3", 1],
  ["1티 지수 셔 반차3", 1],
]
for (const [text, count] of GROUPINGS) {
  cases.push({ text, expect: { count } })
}

// C. Cross-store 여러 매장
const CROSS = [
  "1번방 마 지수 퍼 신 은빈 셔 완메",
  "1t 마 지수 퍼 완메 라 수영 셔 반티",
]
for (const text of CROSS) {
  cases.push({ text, expect: { count: 2 } })
}

// D. 실 인사말 노이즈
const NOISE = [
  "안녕하세요 1번방 지수 셔 완메",
  "1번방 지수 셔 완메 감사합니다",
  "1t 지수 셔 완메!!!",
  "부탁드립니다 1번방 지수 셔 반차3",
]
for (const text of NOISE) {
  cases.push({ text, expect: { count: 1 } })
}

let pass = 0, fail = []
for (const c of cases) {
  const r = parseStaffChat(c.text)
  const cnt = r.entries.length
  let ok = false
  if (c.expect.count !== undefined) {
    ok = cnt === c.expect.count
  } else {
    // 단일 이름 매장/카테고리/티켓 검증
    const e = r.entries[0]
    ok = cnt === 1 && e?.room_no === c.expect.room
      && (c.expect.store === "본매장" ? !e?.origin_store_name : e?.origin_store_name === c.expect.store)
      && e?.category === c.expect.cat
      && e?.ticket_type === c.expect.tk
  }
  if (ok) pass++
  else {
    fail.push({
      text: c.text,
      expect: c.expect,
      got: r.entries.map(e => `${e.origin_store_name??"본"}·${e.name}·${e.category??"-"}·${e.ticket_type??"-"}·r${e.room_no??"-"}`).join(" | "),
      count_got: cnt,
    })
  }
}

console.log(`\n=== ${pass}/${cases.length} pass (${((pass/cases.length)*100).toFixed(1)}%) ===`)
if (fail.length > 0) {
  console.log(`\nFAIL 목록 (${fail.length}건, 최대 15 표시):`)
  for (const f of fail.slice(0, 15)) {
    console.log(`  ✗ '${f.text}'`)
    console.log(`    exp: ${JSON.stringify(f.expect)}`)
    console.log(`    got: ${f.got || "(empty)"} · count=${f.count_got}`)
  }
}
