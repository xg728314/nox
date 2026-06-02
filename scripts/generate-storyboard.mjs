#!/usr/bin/env node
/**
 * 스토리보드 HTML 생성 — 사용 설명서 형식
 *
 * 입력:
 *   public/m/_arch/screens/*.png  (capture-mobile-screens.mjs 결과)
 *   페이지 메타데이터 (이 파일 내 PAGE_META 객체)
 *
 * 출력:
 *   public/m/_arch/storyboard.html
 *
 * 실행:
 *   node scripts/generate-storyboard.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const MAP_DIR = path.join(ROOT, "public/m/_arch")
const SCREENS_DIR = path.join(MAP_DIR, "screens")

// ───────── 페이지 메타데이터 ─────────
// section: '홈' | '스태프' | '메이드 등록' | '채팅' | '정산' | '매장' | '내정보'
const PAGE_META = {
  "index.html": {
    section: "홈",
    title: "홈 (대시보드)",
    desc: "오늘 영업일 한눈 보기. 채팅 미리보기 + 우리 스태프 상태 + 곧 끝나는 메이드 + 매장별 분포까지 한 화면에.",
    actions: [
      "상단 검색 — 스태프/매장/종목 빠른 조회",
      "채팅 카드 → 해당 채팅방 입장",
      "+ 버튼 (우측 하단) → 빠른 메이드 등록",
      "하단 탭바 — 홈/스태프/채팅/정산/내정보 5개 섹션",
    ],
    next: ["chat.html", "staff-list.html", "add-maid-fast.html", "settle.html", "me.html"],
  },
  "staff-list.html": {
    section: "스태프",
    title: "내 스태프 목록",
    desc: "본인이 관리하는 아가씨 목록. 일하는 중 / 대기 / 휴식 상태 필터링.",
    actions: [
      "스태프 카드 클릭 → 상세 화면",
      "+ 버튼 → 새 스태프 등록",
      "필터 칩 — 전체/일하는중/대기/휴식",
    ],
    next: ["staff.html", "add-staff.html"],
  },
  "staff.html": {
    section: "스태프",
    title: "스태프 상세",
    desc: "한 명의 아가씨 상세 정보. 누적 출근, 매출, 페널티, 메모 등.",
    actions: [
      "출근 정보 / 정산 이력 / 페널티 기록",
      "→ 페널티 규칙 보기",
      "→ 출근 체크 화면",
    ],
    next: ["staff-rules.html", "attendance.html"],
  },
  "staff-rules.html": {
    section: "스태프",
    title: "스태프 규칙 / 페널티",
    desc: "매장 규칙 + 위반 시 페널티 금액. 매장 운영 룰 명문화.",
    actions: ["규칙 항목 확인", "← 뒤로 (스태프 상세로 복귀)"],
    next: [],
  },
  "add-staff.html": {
    section: "스태프",
    title: "스태프 등록",
    desc: "새 아가씨를 본인 식구로 등록. 이름, 연락처, 입금 계좌 등.",
    actions: ["기본 정보 입력 → 저장", "원소속 매장 선택 (cross-store 식구일 경우)"],
    next: ["staff-list.html"],
  },
  "add-maid-fast.html": {
    section: "메이드 등록",
    title: "빠른 메이드 등록",
    desc: "이미 등록된 식구를 1탭으로 빠르게 메이드 등록. 가장 자주 쓰는 흐름.",
    actions: ["스태프 카드 탭 → 종목 → 시간 → 등록"],
    next: ["assign-session.html", "add-maid.html"],
  },
  "add-maid.html": {
    section: "메이드 등록",
    title: "메이드 등록 (전체)",
    desc: "처음 와본 아가씨거나 식구 외 등록 시 사용. 상세 입력 모드.",
    actions: ["이름/매장/종목 직접 입력", "→ 동명이인 disambig 가 필요하면 검색 화면"],
    next: ["add-maid-search.html"],
  },
  "add-maid-search.html": {
    section: "메이드 등록",
    title: "메이드 검색 등록",
    desc: "5–8F 전체 매장에서 이름 검색 — 동명이인이면 담당실장 + 매장 hint 로 구분.",
    actions: ["이름 입력 → 일치 목록", "체크 → 등록"],
    next: ["add-maid.html"],
  },
  "assign-session.html": {
    section: "메이드 등록",
    title: "세션 등록 (대기자 → 룸)",
    desc: "대기자 한 명을 어느 룸/매장에 P/S/H 어느 시간으로 들여보낼지. 시작 시각 ±조정도 가능.",
    actions: [
      "Step 1 층 선택 (5–8F)",
      "Step 2 룸 선택",
      "Step 3 종목 (P/S/H 타입)",
      "Step 4 시간 (기본/반티/차3)",
      "Step 5 시작 시각 ±조정 (안 건드리면 현재 시각)",
      "→ 등록 → 본 매장 카운터 세션 생성",
    ],
    next: ["index.html"],
  },
  "attendance.html": {
    section: "스태프",
    title: "출근 체크",
    desc: "오늘 누가 나왔는지 빠르게 출근/대기/휴식 상태 토글.",
    actions: ["상태 버튼 한 탭으로 갱신", "전체 출근 9명 카운트 표시"],
    next: ["staff-list.html", "chat.html", "add-staff.html"],
  },
  "chat.html": {
    section: "채팅",
    title: "채팅방 목록",
    desc: "14매장 실장방 + 우리 매장 실장방 + 그룹/DM 한 목록에. 미읽 unread 표시.",
    actions: ["채팅방 탭 → 입장", "+ 버튼 → 새 채팅방 생성"],
    next: ["chat-room.html", "chat-create.html"],
  },
  "chat-room.html": {
    section: "채팅",
    title: "채팅방 (대화)",
    desc: "실장끼리 메시지 + 메이드 등록 카드 + NOX 자동 알림이 한 흐름에. 메이드 카드는 양쪽 ✓ 확인 후 등록 확정.",
    actions: [
      "메시지 입력 + 보내기",
      "+ 버튼 → 메이드 등록 시트 (내 식구 / 전체 5–8F / 검색 / 멀티 선택 / 매장 선택)",
      "메이드 카드 → ✓ 확인됨 / ❌ 이상해요",
    ],
    next: ["chat.html"],
  },
  "chat-create.html": {
    section: "채팅",
    title: "새 채팅방 생성",
    desc: "실장/아가씨 검색해 그룹 채팅방을 새로 만든다.",
    actions: ["참여자 검색 → 추가 → 방 생성"],
    next: ["chat.html"],
  },
  "settle.html": {
    section: "정산",
    title: "정산 (개인)",
    desc: "본인이 관리하는 식구들의 누적 정산 — 종목별 / 매장별 / 시간대별 분포.",
    actions: ["기간 필터", "스태프별 상세 정산", "→ 매장 정산 보기 (사장권한일 때)"],
    next: ["store-settlement.html"],
  },
  "store-settlement.html": {
    section: "정산",
    title: "매장 정산 (사장 view)",
    desc: "매장 전체 일/주/월 정산 요약. 사장 권한일 때 보임.",
    actions: ["기간 토글", "매장별 / 종목별 breakdown", "→ 매장 상세"],
    next: ["store-detail.html"],
  },
  "store-detail.html": {
    section: "매장",
    title: "매장 상세",
    desc: "매장별 운영 정보 — 룸 현황, 스태프, 매출, 설정.",
    actions: ["룸 현황 / 영업 상태", "→ 매장 설정 (단가/페널티)"],
    next: ["store-settings.html"],
  },
  "store-settings.html": {
    section: "매장",
    title: "매장 설정",
    desc: "종목별 단가, 카드수수료, 웨이터팁 기본값, 영업일 잠금 등.",
    actions: ["P/S/H 타입별 시간/단가 편집", "영업일 진행 중 잠금"],
    next: ["store-detail.html"],
  },
  "me.html": {
    section: "내정보",
    title: "내 정보",
    desc: "본인 프로필, 매장 전환, 알림 설정, 로그아웃.",
    actions: ["매장 전환 (멀티 매장 멤버십)", "MFA / 비밀번호 변경", "로그아웃"],
    next: [],
  },
}

const SECTION_ORDER = ["홈", "스태프", "메이드 등록", "채팅", "정산", "매장", "내정보"]
const SECTION_COLORS = {
  "홈": "#F59E0B",
  "스태프": "#22C55E",
  "메이드 등록": "#C49B61",
  "채팅": "#3B82F6",
  "정산": "#8B5CF6",
  "매장": "#EC4899",
  "내정보": "#7A746A",
}

// ───────── HTML 생성 ─────────
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function findScreenshot(filename) {
  const png = filename.replace(".html", ".png")
  const full = path.join(SCREENS_DIR, png)
  return fs.existsSync(full) ? `./screens/${png}` : null
}

const today = new Date().toISOString().slice(0, 10)

const pagesArr = Object.entries(PAGE_META).map(([file, meta]) => ({ file, ...meta }))
const bySection = new Map()
for (const p of pagesArr) {
  if (!bySection.has(p.section)) bySection.set(p.section, [])
  bySection.get(p.section).push(p)
}

let body = `
<header class="hero">
  <h1>NOX 모바일 앱 — 사용 설명서</h1>
  <p class="subtitle">스태프동기화 · 14매장 실장 공동 사용 · 5–8F</p>
  <div class="meta">
    <span>총 ${pagesArr.length} 화면</span>
    <span>마지막 갱신: ${today}</span>
    <span><a href="./map.html">→ 아키텍처 그래프</a> · <a href="./sitemap.md">→ 사이트맵 md</a></span>
  </div>
</header>

<nav class="toc">
  <strong>섹션 바로가기:</strong>
  ${SECTION_ORDER.filter((s) => bySection.has(s))
    .map((s) => `<a href="#sec-${esc(s)}" style="--c:${SECTION_COLORS[s]}">${esc(s)}</a>`)
    .join("")}
</nav>
`

for (const section of SECTION_ORDER) {
  const pages = bySection.get(section)
  if (!pages || pages.length === 0) continue
  const color = SECTION_COLORS[section] || "#888"
  body += `\n<section class="sec" id="sec-${esc(section)}" style="--sec-c:${color}">\n`
  body += `  <h2><span class="sec-dot"></span>${esc(section)}<small>(${pages.length}개 화면)</small></h2>\n`
  body += `  <div class="cards">\n`
  for (const p of pages) {
    const ss = findScreenshot(p.file)
    body += `    <article class="card">\n`
    body += `      <div class="phone">\n`
    if (ss) body += `        <img src="${ss}" alt="${esc(p.title)}" loading="lazy" />\n`
    else body += `        <div class="no-ss">스크린샷 없음</div>\n`
    body += `      </div>\n`
    body += `      <div class="info">\n`
    body += `        <h3>${esc(p.title)} <code>/m/${esc(p.file)}</code></h3>\n`
    body += `        <p class="desc">${esc(p.desc)}</p>\n`
    if (p.actions && p.actions.length > 0) {
      body += `        <div class="block">\n          <div class="block-lbl">여기서 할 수 있는 것</div>\n          <ul>\n`
      for (const a of p.actions) body += `            <li>${esc(a)}</li>\n`
      body += `          </ul>\n        </div>\n`
    }
    if (p.next && p.next.length > 0) {
      body += `        <div class="block">\n          <div class="block-lbl">다음으로 갈 수 있는 화면</div>\n          <div class="nexts">\n`
      for (const n of p.next) {
        const target = PAGE_META[n]
        const tlbl = target ? `${target.title} (${n})` : n
        body += `            <a href="#card-${esc(n)}" class="next-chip">${esc(tlbl)}</a>\n`
      }
      body += `          </div>\n        </div>\n`
    }
    body += `      </div>\n    </article>\n`
  }
  body += `  </div>\n</section>\n`
}

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NOX 모바일 앱 — 사용 설명서</title>
<style>
  :root { --bg:#F8F4ED; --ink:#2D2B26; --line:#D8D2C8; --card:#FFFCF6; --sub:#7A746A; --gold:#C49B61; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif; line-height: 1.5; }
  .hero { padding: 32px 24px 20px; background: linear-gradient(135deg, var(--card), #F5EFE3); border-bottom: 1px solid var(--line); }
  .hero h1 { margin: 0 0 4px; font-size: 24px; font-weight: 800; letter-spacing: -0.025em; }
  .hero .subtitle { margin: 0 0 12px; color: var(--sub); font-size: 14px; font-weight: 600; }
  .hero .meta { display: flex; gap: 16px; font-size: 12px; color: var(--sub); font-weight: 600; flex-wrap: wrap; }
  .hero .meta a { color: var(--gold); text-decoration: none; }
  .toc { padding: 14px 24px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; position: sticky; top: 0; z-index: 10; backdrop-filter: blur(8px); }
  .toc strong { font-size: 12px; font-weight: 800; color: var(--sub); margin-right: 4px; }
  .toc a { padding: 4px 12px; font-size: 12px; font-weight: 800; text-decoration: none; color: var(--c, var(--ink)); border-radius: 999px; background: color-mix(in srgb, var(--c, var(--ink)) 12%, transparent); }
  .sec { padding: 32px 24px; border-bottom: 1px solid var(--line); }
  .sec h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 20px; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
  .sec h2 .sec-dot { width: 14px; height: 14px; border-radius: 4px; background: var(--sec-c); flex-shrink: 0; }
  .sec h2 small { font-size: 12px; color: var(--sub); font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(640px, 1fr)); gap: 24px; }
  @media (max-width: 720px) { .cards { grid-template-columns: 1fr; } }
  .card { display: flex; gap: 18px; padding: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  @media (max-width: 540px) { .card { flex-direction: column; align-items: center; } }
  .phone { width: 220px; aspect-ratio: 390/844; flex-shrink: 0; background: #000; border-radius: 28px; padding: 6px; box-shadow: 0 6px 20px rgba(0,0,0,0.15); }
  .phone img { width: 100%; height: 100%; object-fit: cover; border-radius: 22px; display: block; background: var(--bg); }
  .phone .no-ss { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #666; font-size: 11px; font-weight: 600; border-radius: 22px; background: #1a1a1a; }
  .info { flex: 1; min-width: 0; }
  .info h3 { margin: 0 0 6px; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .info h3 code { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 600; color: var(--sub); background: var(--bg); padding: 2px 8px; border-radius: 6px; }
  .info .desc { margin: 0 0 12px; font-size: 13px; color: #4A4640; }
  .block { margin-top: 10px; }
  .block-lbl { font-size: 10px; font-weight: 800; color: var(--sub); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .block ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.55; }
  .block ul li { margin-bottom: 2px; }
  .nexts { display: flex; gap: 6px; flex-wrap: wrap; }
  .next-chip { padding: 4px 10px; font-size: 11px; font-weight: 700; text-decoration: none; background: rgba(196,155,97,0.15); color: var(--gold); border-radius: 999px; }
  .next-chip:hover { background: rgba(196,155,97,0.28); }
</style>
</head>
<body>
${body}
</body>
</html>
`

fs.writeFileSync(path.join(MAP_DIR, "storyboard.html"), html, "utf8")

// 카드 id 가 src 페이지의 anchor 와 매칭되도록 한 번 더 후처리
// (next 화살표가 동일 페이지 내에서 jump 하도록 — section id 가 아닌 card id)
// 위 body 빌더에서 카드 anchor 를 미리 박지 않았으므로 다시 보정.
// 간단히 sed-like 치환: <article class="card"> 를 <article class="card" id="card-{file}"> 으로.
let saved = fs.readFileSync(path.join(MAP_DIR, "storyboard.html"), "utf8")
let cardIdx = 0
const flatPages = []
for (const section of SECTION_ORDER) {
  const pages = bySection.get(section) || []
  for (const p of pages) flatPages.push(p.file)
}
saved = saved.replace(/<article class="card">/g, () => {
  const f = flatPages[cardIdx++]
  return `<article class="card" id="card-${f}">`
})
fs.writeFileSync(path.join(MAP_DIR, "storyboard.html"), saved, "utf8")

console.log(`Generated: public/m/_arch/storyboard.html (${pagesArr.length} pages, ${bySection.size} sections)`)
