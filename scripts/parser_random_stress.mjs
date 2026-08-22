import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"

const STORES = [
  ["라이브", "라"], ["마블", "마"], ["버닝", "버"], ["황진이", "황"],
  ["신세계", "신"], ["아우라", "아우"], ["아지트", "아지"], ["퍼스트", "퍼스"],
  ["두바이", "두"], ["발리", "발"], ["상한가", "상"], ["토끼", "토"],
  ["8번가", "8번가"], ["썸", "썸"], ["파티", "파"],
]
// 실 DB 아가씨 이름 (샘플)
const NAMES = [
  "가은","김나미","김미리","나래","다은","다인","미라","미연","박미리",
  "별","보영","서연","소희","수민","수연","수영","예린","유나","유리",
  "윤지","은지","지연","지유","지호","지효","채린","채아","채은","하늘",
  "하영","화영",
]
const CATS = ["퍼", "셔", "하"]
const TICKETS = ["완메", "반티", "차3", "반차3"]

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)] }
function shuffle(a){ return [...a].sort(()=>Math.random()-0.5) }

// 시나리오별 랜덤 케이스 생성
const cases = []
// A) 매장 축약 + 이름 1 + cat + ticket
for (let i=0; i<15; i++) {
  const [full, short] = STORES[i]
  const nm = pick(NAMES)
  cases.push({ type:"A", input:`${short} ${nm} ${pick(CATS)} ${pick(TICKETS)}`, expect:{ store: full, name: nm }})
}
// B) 매장 + 룸번호 + 이름 여러 명 + cat + ticket
for (let i=0; i<15; i++) {
  const [full, short] = STORES[i]
  const names = shuffle(NAMES).slice(0, 2+Math.floor(Math.random()*3))
  const room = 1+Math.floor(Math.random()*8)
  cases.push({ type:"B", input:`${short} ${room}번방 ${names.join(" ")} ${pick(CATS)} ${pick(TICKETS)}`, expect:{ store: full, room: String(room), names }})
}
// C) 이름-종목 그룹핑
for (let i=0; i<10; i++) {
  const [full, short] = STORES[i % STORES.length]
  const g1 = shuffle(NAMES).slice(0, 1+Math.floor(Math.random()*2))
  const g2 = shuffle(NAMES).slice(0, 1+Math.floor(Math.random()*2))
  cases.push({ type:"C", input:`${short} ${g1.join(" ")} ${pick(CATS)} ${g2.join(" ")} ${pick(CATS)} ${pick(TICKETS)}`, expect:{ store: full }})
}

let passA=0, passB=0, passC=0, failA=[], failB=[], failC=[]
for (const c of cases) {
  const r = parseStaffChat(c.input)
  if (c.type === "A") {
    const e = r.entries[0]
    const ok = e && e.origin_store_name === c.expect.store && e.name === c.expect.name
    if (ok) passA++
    else failA.push({ input: c.input, got: r.entries.map(x => `store=${x.origin_store_name} name=${x.name} cat=${x.category} tk=${x.ticket_type}`) })
  } else if (c.type === "B") {
    const okStore = r.entries.every(e => e.origin_store_name === c.expect.store)
    const okRoom = r.entries.every(e => e.room_no === c.expect.room)
    const gotNames = new Set(r.entries.map(e => e.name))
    const okNames = c.expect.names.every(n => gotNames.has(n))
    if (okStore && okRoom && okNames) passB++
    else failB.push({ input: c.input, expected: c.expect, got: r.entries.map(x => `store=${x.origin_store_name} room=${x.room_no} name=${x.name}`) })
  } else {
    // C: 그룹핑 · store 만 검증 (그룹 정확 검증은 복잡)
    const okStore = r.entries.length > 0 && r.entries.every(e => e.origin_store_name === c.expect.store)
    if (okStore) passC++
    else failC.push({ input: c.input, got: r.entries.map(x => `store=${x.origin_store_name} name=${x.name} cat=${x.category}`) })
  }
}

console.log(`\n=== 결과 ===`)
console.log(`A) 매장+이름+카테고리+티켓 : ${passA}/${cases.filter(c=>c.type==="A").length}`)
console.log(`B) 매장+룸+이름들+카테고리+티켓 : ${passB}/${cases.filter(c=>c.type==="B").length}`)
console.log(`C) 이름-종목 그룹핑 : ${passC}/${cases.filter(c=>c.type==="C").length}`)

if (failA.length) { console.log("\n[A FAILS]"); failA.slice(0,5).forEach(f=>console.log(" ", f.input, "→", f.got.join(" | "))) }
if (failB.length) { console.log("\n[B FAILS]"); failB.slice(0,5).forEach(f=>console.log(" ", f.input, "→", f.got.join(" | "))) }
if (failC.length) { console.log("\n[C FAILS]"); failC.slice(0,5).forEach(f=>console.log(" ", f.input, "→", f.got.join(" | "))) }
