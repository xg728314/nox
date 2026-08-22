import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"
const STORES = [
  ["라이브", "라"], ["마블", "마"], ["버닝", "버"], ["황진이", "황"],
  ["신세계", "신"], ["아우라", "아우"], ["아지트", "아지"], ["퍼스트", "퍼스"],
  ["두바이", "두"], ["발리", "발"], ["상한가", "상"], ["토끼", "토"],
  ["8번가", "8번가"], ["썸", "썸"], ["파티", "파"],
]
const NAMES = ["가은","김나미","김미리","나래","다은","다인","미라","미연","박미리","별","보영","서연","소희","수민","수연","수영","예린","유나","유리","윤지","은지","지연","지유","지호","지효","채린","채아","채은","하늘","하영","화영"]
const CATS = ["퍼", "셔", "하"]
const TICKETS = ["완메", "반티", "차3", "반차3"]
const CATS_FULL = { "퍼":"퍼블릭", "셔":"셔츠", "하":"하퍼" }
const TICKETS_FULL = { "완메":"완티", "반티":"반티", "차3":"차3", "반차3":"반차3" }
function pick(a){ return a[Math.floor(Math.random()*a.length)] }
function shuffle(a){ return [...a].sort(()=>Math.random()-0.5) }

const results = { total: 0, pass: 0, fail: [] }
for (let i=0; i<200; i++) {
  const [full, short] = pick(STORES)
  const useShort = Math.random() < 0.7
  const storeToken = useShort ? short : full
  const includeRoom = Math.random() < 0.6
  const roomN = 1 + Math.floor(Math.random() * 8)
  const roomToken = includeRoom ? (Math.random() < 0.7 ? `${roomN}번방` : `${roomN}T`) : ""
  const nCount = 1 + Math.floor(Math.random() * 4)
  const names = shuffle(NAMES).slice(0, nCount)
  const cat = pick(CATS)
  const tick = pick(TICKETS)

  const parts = [storeToken, roomToken, ...names, cat, tick].filter(Boolean)
  const input = parts.join(" ")
  const r = parseStaffChat(input)

  const expStore = full
  const expRoom = includeRoom ? String(roomN) : null
  const expCat = CATS_FULL[cat]
  const expTick = TICKETS_FULL[tick]
  const gotNames = new Set(r.entries.map(e => e.name))

  const okCount = r.entries.length === names.length
  const okStore = r.entries.every(e => e.origin_store_name === expStore)
  const okRoom = expRoom === null ? true : r.entries.every(e => e.room_no === expRoom)
  const okCat = r.entries.every(e => e.category === expCat)
  const okTick = r.entries.every(e => e.ticket_type === expTick)
  const okNames = names.every(n => gotNames.has(n))
  const allOk = okCount && okStore && okRoom && okCat && okTick && okNames

  results.total++
  if (allOk) results.pass++
  else results.fail.push({
    input,
    exp: { store: expStore, room: expRoom, names, cat: expCat, tick: expTick },
    got: r.entries.map(e => ({ store: e.origin_store_name, room: e.room_no, name: e.name, cat: e.category, tick: e.ticket_type })),
    reasons: [
      !okCount && `count exp=${names.length} got=${r.entries.length}`,
      !okStore && "store",
      !okRoom && "room",
      !okCat && "cat",
      !okTick && "tick",
      !okNames && "names",
    ].filter(Boolean),
  })
}

console.log(`\n${results.pass}/${results.total} pass (${((results.pass/results.total)*100).toFixed(1)}%)`)
if (results.fail.length > 0) {
  console.log(`\n[FAILS · 최대 10개 표시]`)
  for (const f of results.fail.slice(0, 10)) {
    console.log(`  '${f.input}'`)
    console.log(`    reasons: ${f.reasons.join(", ")}`)
    console.log(`    exp: ${JSON.stringify(f.exp)}`)
    console.log(`    got: ${JSON.stringify(f.got)}`)
  }
}
