#!/usr/bin/env node
/**
 * NOX 아키텍처 자동 도면 생성기
 *
 * 산출물:
 *   _arch/sitemap.md           - 페이지 간 이동 (Mermaid)
 *   _arch/api-graph.md         - 페이지 → API endpoint (Mermaid)
 *   public/m/_arch/map.html    - vis-network 인터랙티브 뷰어
 *
 * 재생성:
 *   node scripts/generate-architecture-map.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const MOBILE_DIR = path.join(ROOT, "public/m")
const APP_DIR = path.join(ROOT, "app")
const ARCH_DIR = path.join(ROOT, "_arch")
const MAP_DIR = path.join(ROOT, "public/m/_arch")

// ───────── NoxAPI 메서드 → REST endpoint 매핑 ─────────
const NOXAPI_TO_ENDPOINT = {
  me: "/api/auth/me",
  memberships: "/api/auth/memberships",
  logout: "/api/auth/logout",
  hostesses: "/api/manager/hostesses",
  rooms: "/api/rooms",
  serviceTypes: "/api/store/service-types",
  buildingHostesses: "/api/building/hostesses",
  buildingStores: "/api/building/stores",
  checkin: "/api/sessions/checkin",
  addParticipant: "/api/sessions/participants",
  session: "/api/sessions/[session_id]",
  settlement: "/api/manager/settlement/summary",
  crossStoreSettlement: "/api/cross-store/settlement",
  chatRooms: "/api/chat/rooms",
  chatMessages: "/api/chat/messages",
  sendMessage: "/api/chat/messages",
  attendance: "/api/attendance",
  setAttendance: "/api/attendance",
}

// ───────── helpers ─────────
function walk(dir, filter) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

function relFromRoot(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, "/")
}

function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

function esc(s) {
  return String(s)
    .replace(/"/g, "&quot;")
    .replace(/\|/g, "\\|")
}

function appPagePath(absPath) {
  // app/counter/[room_id]/page.tsx → /counter/[room_id]
  const rel = relFromRoot(absPath)
  return rel.replace(/^app/, "").replace(/\/page\.tsx$/, "") || "/"
}

function apiPath(absPath) {
  const rel = relFromRoot(absPath)
  return rel.replace(/^app/, "").replace(/\/route\.ts$/, "")
}

function section(p) {
  // /counter/[room_id]/payment → counter
  // /api/sessions/checkin → api
  const m = p.match(/^\/([^/]+)/)
  return m ? m[1] : "root"
}

// ───────── 1) 스캔 ─────────
const mobileFiles = walk(MOBILE_DIR, (p) => p.endsWith(".html") && !p.includes("_arch"))
const appPageFiles = walk(APP_DIR, (p) => p.endsWith("page.tsx"))
const apiRouteFiles = walk(APP_DIR, (p) => p.endsWith("route.ts"))

const mobileByName = new Map()
for (const f of mobileFiles) mobileByName.set(path.basename(f), "m:" + path.basename(f))

const appPathSet = new Set()
for (const f of appPageFiles) appPathSet.add(appPagePath(f))

const apiPathSet = new Set()
for (const f of apiRouteFiles) apiPathSet.add(apiPath(f))

// ───────── 2) 노드 + 간선 추출 ─────────
const nodes = new Map() // id → { id, label, type, file, section }
const edges = [] // { from, to, kind }
const issues = { deadLinks: [], orphans: [], cycles: [], unusedEndpoints: [] }

function addNode(id, label, type, file) {
  if (nodes.has(id)) return
  nodes.set(id, { id, label, type, file, section: section(label.startsWith("/") ? label : "/" + label) })
}

// 모바일 페이지
for (const f of mobileFiles) {
  const name = path.basename(f)
  const id = "m:" + name
  addNode(id, name, "mobile", relFromRoot(f))
  const content = fs.readFileSync(f, "utf8")

  // href="page.html"
  for (const m of content.matchAll(/href=["']([a-zA-Z0-9_\-]+\.html)(?:\?[^"']*)?["']/g)) {
    const target = m[1]
    if (mobileByName.has(target)) {
      edges.push({ from: id, to: mobileByName.get(target), kind: "nav" })
    } else {
      issues.deadLinks.push(`${name} → ${target}`)
    }
  }
  // location.href = "page.html"
  for (const m of content.matchAll(/location\.href\s*=\s*["'`]([a-zA-Z0-9_\-]+\.html)(?:\?[^"'`]*)?["'`]/g)) {
    const target = m[1]
    if (mobileByName.has(target)) {
      edges.push({ from: id, to: mobileByName.get(target), kind: "nav-js" })
    } else {
      issues.deadLinks.push(`${name} → ${target} (js)`)
    }
  }
  // NoxAPI.X(
  for (const m of content.matchAll(/NoxAPI\.([a-zA-Z]+)\s*\(/g)) {
    const method = m[1]
    const endpoint = NOXAPI_TO_ENDPOINT[method]
    if (endpoint) {
      const tid = "a:" + endpoint
      addNode(tid, endpoint, "api", endpoint)
      edges.push({ from: id, to: tid, kind: "api" })
    }
  }
  // fetch("/api/...")
  for (const m of content.matchAll(/fetch\(["'`](\/api\/[^"'`?\s]+)/g)) {
    const tid = "a:" + m[1]
    addNode(tid, m[1], "api", m[1])
    edges.push({ from: id, to: tid, kind: "api" })
  }
}

// Next.js 페이지
for (const f of appPageFiles) {
  const p = appPagePath(f)
  const id = "p:" + p
  addNode(id, p, "app-page", relFromRoot(f))
  const content = fs.readFileSync(f, "utf8")

  // <Link href="..."> (string literal)
  for (const m of content.matchAll(/<Link[^>]+href=["'`]([^"'`]+)["'`]/g)) {
    const raw = m[1]
    if (raw.includes("${")) continue
    const t = raw.split("?")[0]
    if (t.startsWith("/")) edges.push({ from: id, to: "p:" + t, kind: "link" })
  }
  // router.push / replace / redirect
  for (const m of content.matchAll(/(?:router\.push|router\.replace|redirect)\(["'`]([^"'`]+)["'`]/g)) {
    const raw = m[1]
    // template literal with ${var} — 정적 URL 이 아님, 스킵
    if (raw.includes("${")) continue
    const t = raw.split("?")[0]
    if (t.startsWith("/m/")) {
      // /m/index.html — 모바일로 리다이렉트
      const basename = t.replace(/^\/m\//, "")
      if (mobileByName.has(basename)) {
        edges.push({ from: id, to: mobileByName.get(basename), kind: "redirect" })
      } else {
        issues.deadLinks.push(`${p} → ${t} (redirect, mobile not found)`)
      }
    } else if (t.startsWith("/")) {
      edges.push({ from: id, to: "p:" + t, kind: "redirect" })
    }
  }
  // fetch("/api/...")
  for (const m of content.matchAll(/fetch\(["'`](\/api\/[^"'`?\s]+)/g)) {
    const tid = "a:" + m[1]
    addNode(tid, m[1], "api", m[1])
    edges.push({ from: id, to: tid, kind: "api" })
  }
  // apiFetch("/api/...")
  for (const m of content.matchAll(/apiFetch\(["'`](\/api\/[^"'`?\s]+)/g)) {
    const tid = "a:" + m[1]
    addNode(tid, m[1], "api", m[1])
    edges.push({ from: id, to: tid, kind: "api" })
  }
}

// API 노드 등록 (호출 없는 endpoint 도 포함)
for (const f of apiRouteFiles) {
  const p = apiPath(f)
  addNode("a:" + p, p, "api", relFromRoot(f))
}

// ───────── 3) 이슈 검출 ─────────
// 끊어진 링크: app page link 가 존재하지 않는 path 인 경우
for (const e of edges) {
  if (e.kind === "link" || e.kind === "redirect") {
    if (e.to.startsWith("p:")) {
      const p = e.to.slice(2)
      // 동적 라우트 매칭: /counter/[room_id] vs /counter/abc-uuid
      const matches = [...appPathSet].some((known) => {
        if (known === p) return true
        // [param] 치환 매칭
        const pattern = "^" + known.replace(/\[[^\]]+\]/g, "[^/]+") + "$"
        return new RegExp(pattern).test(p)
      })
      if (!matches) {
        const from = nodes.get(e.from)?.label || e.from
        issues.deadLinks.push(`${from} → ${p} (page not found)`)
      }
    }
  }
}

// 고아: 진입 간선이 없는 페이지
const TOP_LEVEL = new Set(["p:/", "p:/login", "m:index.html", "m:login.html"])
const incoming = new Map()
for (const e of edges) {
  if (!incoming.has(e.to)) incoming.set(e.to, [])
  incoming.get(e.to).push(e.from)
}
for (const [id, n] of nodes) {
  if (n.type === "api") continue
  if (TOP_LEVEL.has(id)) continue
  if (!incoming.has(id) || incoming.get(id).length === 0) {
    issues.orphans.push(`${n.label} (${n.file})`)
  }
}

// 사용 안 되는 API endpoint
for (const [id, n] of nodes) {
  if (n.type !== "api") continue
  if (!incoming.has(id) || incoming.get(id).length === 0) {
    issues.unusedEndpoints.push(`${n.label} (${n.file})`)
  }
}

// 순환 — Tarjan SCC 간단 버전
{
  const adj = new Map()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push(e.to)
  }
  const visited = new Set()
  const stack = new Set()
  function dfs(node, pathArr) {
    if (stack.has(node)) {
      const idx = pathArr.indexOf(node)
      const cyc = pathArr.slice(idx).concat(node).map((n) => nodes.get(n)?.label || n)
      issues.cycles.push(cyc)
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    stack.add(node)
    for (const next of adj.get(node) || []) dfs(next, [...pathArr, node])
    stack.delete(node)
  }
  for (const id of nodes.keys()) if (!visited.has(id)) dfs(id, [])
  // 중복 cycle 제거 + 최대 20개
  const seen = new Set()
  issues.cycles = issues.cycles
    .filter((c) => {
      const key = [...c].sort().join("|")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

// ───────── 4) 출력 ─────────
fs.mkdirSync(ARCH_DIR, { recursive: true })
fs.mkdirSync(MAP_DIR, { recursive: true })

const today = new Date().toISOString().slice(0, 10)

// (1) sitemap.md
function mermaidNav(filter, opts = {}) {
  const ns = [...nodes.values()].filter(filter)
  const es = edges.filter((e) => {
    const f = nodes.get(e.from)
    const t = nodes.get(e.to)
    return f && t && filter(f) && filter(t) && e.kind !== "api"
  })
  let out = "```mermaid\ngraph " + (opts.dir || "LR") + "\n"
  for (const n of ns) {
    const cls = n.type === "mobile" ? ":::mobile" : n.type === "app-page" ? ":::app" : ""
    out += `  ${safeId(n.id)}["${esc(n.label)}"]${cls}\n`
  }
  for (const e of es) {
    const arrow = e.kind === "redirect" ? "==>" : e.kind === "nav-js" ? "-.->" : "-->"
    out += `  ${safeId(e.from)} ${arrow} ${safeId(e.to)}\n`
  }
  out += "  classDef mobile fill:#FED7AA,stroke:#F59E0B,color:#7C2D12\n"
  out += "  classDef app fill:#BBF7D0,stroke:#22C55E,color:#14532D\n"
  out += "```\n"
  return out
}

let sitemap = `# NOX Architecture Sitemap (자동 생성)\n\n`
sitemap += `> 마지막 생성: ${today}\n>\n`
sitemap += `> 재생성: \`node scripts/generate-architecture-map.mjs\`\n>\n`
sitemap += `> 인터랙티브 도면: \`public/m/_arch/map.html\` (또는 https://nox.ai.kr/m/_arch/map.html — 로그인 필요)\n\n`

sitemap += `## 통계\n\n`
sitemap += `- 모바일 페이지: **${mobileFiles.length}**\n`
sitemap += `- Next.js 페이지: **${appPageFiles.length}**\n`
sitemap += `- API endpoint: **${apiPathSet.size}**\n`
sitemap += `- 총 노드: ${nodes.size}, 총 간선: ${edges.length}\n\n`

sitemap += `## 모바일 페이지 이동 (\`/m/*.html\`)\n\n`
sitemap += `범례: \`-->\` href · \`-.->\`  location.href\n\n`
sitemap += mermaidNav((n) => n.type === "mobile")

sitemap += `\n## Next.js 페이지 (\`app/**/page.tsx\`)\n\n`
sitemap += `범례: \`-->\` Link · \`==>\` redirect / router.push\n\n`
sitemap += mermaidNav((n) => n.type === "app-page" || n.type === "mobile")

sitemap += `\n## 꼬인 로직 검출\n\n`
sitemap += `### 🔴 끊어진 링크 (대상 페이지 없음)\n\n`
if (issues.deadLinks.length === 0) sitemap += `없음 ✅\n\n`
else {
  for (const x of new Set(issues.deadLinks)) sitemap += `- ${x}\n`
  sitemap += "\n"
}

sitemap += `### 🟡 고아 페이지 (어디서도 진입 없음)\n\n`
if (issues.orphans.length === 0) sitemap += `없음 ✅\n\n`
else {
  for (const x of issues.orphans) sitemap += `- ${x}\n`
  sitemap += "\n"
}

sitemap += `### 🔵 호출 없는 API endpoint\n\n`
if (issues.unusedEndpoints.length === 0) sitemap += `없음 ✅\n\n`
else {
  sitemap += `> 페이지가 직접 부르지 않는 endpoint. 다른 endpoint 가 내부 호출하거나, 외부 cron / 스크립트가 부르거나, 미사용일 수 있음.\n\n`
  for (const x of issues.unusedEndpoints.slice(0, 50)) sitemap += `- ${x}\n`
  if (issues.unusedEndpoints.length > 50) sitemap += `- … 외 ${issues.unusedEndpoints.length - 50}개\n`
  sitemap += "\n"
}

sitemap += `### ↻ 순환 참조\n\n`
if (issues.cycles.length === 0) sitemap += `없음 ✅\n\n`
else {
  for (const c of issues.cycles) sitemap += `- ${c.join(" → ")}\n`
  sitemap += "\n"
}

fs.writeFileSync(path.join(ARCH_DIR, "sitemap.md"), sitemap, "utf8")

// (2) api-graph.md
let apigraph = `# Page → API Endpoint 호출 그래프 (자동 생성)\n\n`
apigraph += `> 마지막 생성: ${today}\n\n`

const apiEdges = edges.filter((e) => e.kind === "api")
const byCaller = new Map()
const byCallee = new Map()
for (const e of apiEdges) {
  if (!byCaller.has(e.from)) byCaller.set(e.from, new Set())
  byCaller.get(e.from).add(e.to)
  if (!byCallee.has(e.to)) byCallee.set(e.to, new Set())
  byCallee.get(e.to).add(e.from)
}

apigraph += `## 페이지별 호출 endpoint (정방향)\n\n`
const sortedCallers = [...byCaller.entries()].sort((a, b) =>
  (nodes.get(a[0])?.label || "").localeCompare(nodes.get(b[0])?.label || ""),
)
for (const [callerId, calleeSet] of sortedCallers) {
  const n = nodes.get(callerId)
  if (!n) continue
  apigraph += `### ${n.label}\n\n`
  for (const c of [...calleeSet].sort()) {
    apigraph += `- ${nodes.get(c).label}\n`
  }
  apigraph += "\n"
}

apigraph += `## API endpoint 사용처 (역방향)\n\n`
const allApiNodes = [...nodes.values()].filter((n) => n.type === "api").sort((a, b) => a.label.localeCompare(b.label))
for (const api of allApiNodes) {
  const callers = byCallee.get(api.id)
  if (!callers || callers.size === 0) {
    apigraph += `### ${api.label} 🔵\n\n호출 페이지 없음 (cron / 내부 / 미사용)\n\n`
  } else {
    apigraph += `### ${api.label}\n\n`
    for (const c of [...callers].sort()) apigraph += `- ${nodes.get(c).label}\n`
    apigraph += "\n"
  }
}

fs.writeFileSync(path.join(ARCH_DIR, "api-graph.md"), apigraph, "utf8")

// (3) 인터랙티브 HTML (vis-network)
const visNodes = [...nodes.values()].map((n) => ({
  id: n.id,
  label: n.label,
  group: n.type,
  title: `${n.label}\n${n.file}`,
}))
const visEdges = edges.map((e, i) => ({
  id: "e" + i,
  from: e.from,
  to: e.to,
  label: e.kind,
  arrows: "to",
  font: { size: 8, color: "#888" },
  smooth: { type: "continuous" },
  color: {
    color:
      e.kind === "api" ? "#3B82F6" : e.kind === "redirect" ? "#EF4444" : e.kind === "nav-js" ? "#8B5CF6" : "#A0A0A0",
  },
}))

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NOX 아키텍처 도면</title>
<script src="/m/_arch/vis-network.min.js"></script>
<style>
  :root { --bg:#F8F4ED; --ink:#2D2B26; --line:#D8D2C8; --card:#FFFCF6; --sub:#7A746A; --gold:#C49B61; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--ink); font-family: -apple-system, system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  .topbar { padding: 10px 14px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
  .topbar h1 { margin: 0; font-size: 14px; font-weight: 800; }
  .topbar .stats { font-size: 11px; color: var(--sub); font-weight: 700; padding: 2px 8px; background: var(--bg); border-radius: 999px; }
  .topbar input[type=text] { flex: 1; min-width: 140px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; font-family: inherit; }
  .topbar label { font-size: 11px; font-weight: 700; cursor: pointer; padding: 4px 8px; border-radius: 999px; user-select: none; display: inline-flex; align-items: center; gap: 4px; }
  .topbar label.mobile { background: rgba(245, 158, 11, 0.15); color: #B45309; }
  .topbar label.app-page { background: rgba(34, 197, 94, 0.15); color: #15803D; }
  .topbar label.api { background: rgba(59, 130, 246, 0.15); color: #1D4ED8; }
  .topbar input[type=checkbox] { accent-color: currentColor; margin: 0; }
  #net { flex: 1; min-height: 400px; height: 100%; background: #FBF8F2; position: relative; }
  #net::before { content: "그래프 로딩 중..."; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--sub); font-size: 13px; font-weight: 700; pointer-events: none; }
  #net.ready::before { display: none; }
  #net-error { padding: 20px; color: #B91C1C; font-size: 12px; display: none; background: rgba(239,68,68,0.05); border-radius: 8px; margin: 10px; }
  #net-error.show { display: block; }
  #detail { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); border-top: 1px solid var(--line); padding: 12px 14px 16px; max-height: 45vh; overflow-y: auto; display: none; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
  #detail h3 { margin: 0 0 6px; font-size: 14px; font-weight: 800; }
  #detail .meta { font-size: 11px; color: var(--sub); margin-bottom: 8px; font-family: ui-monospace, monospace; }
  #detail .sec { margin-top: 10px; font-size: 11px; font-weight: 800; color: var(--sub); text-transform: uppercase; letter-spacing: 0.05em; }
  #detail ul { margin: 4px 0 0 14px; padding: 0; font-size: 12px; }
  #detail .close { float: right; cursor: pointer; padding: 2px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); font-size: 11px; font-weight: 700; }
  .issues { padding: 10px 14px; background: rgba(239, 68, 68, 0.05); border-bottom: 1px solid var(--line); font-size: 11px; flex-shrink: 0; }
  .issues b { color: #B91C1C; }
</style>
</head>
<body>
<div class="topbar">
  <h1>NOX 아키텍처 도면</h1>
  <span class="stats">노드 ${visNodes.length} · 간선 ${visEdges.length}</span>
  <label class="mobile"><input type="checkbox" data-group="mobile" checked /> Mobile (${mobileFiles.length})</label>
  <label class="app-page"><input type="checkbox" data-group="app-page" checked /> Next.js (${appPageFiles.length})</label>
  <label class="api"><input type="checkbox" data-group="api" checked /> API (${apiPathSet.size})</label>
  <input type="text" id="search" placeholder="이름 검색 (예: chat, settlement, assign)" />
</div>
<div class="issues">
  꼬인 로직: 끊어진 링크 <b>${new Set(issues.deadLinks).size}</b>개 · 고아 페이지 <b>${issues.orphans.length}</b>개 · 미사용 API <b>${issues.unusedEndpoints.length}</b>개 · 순환 <b>${issues.cycles.length}</b>개
  <span style="float:right; color:var(--sub);">상세는 <a href="/m/_arch/sitemap.md" style="color:var(--gold);">sitemap.md</a> 참조</span>
</div>
<div id="net"></div>
<div id="net-error"></div>
<div id="detail">
  <span class="close" onclick="document.getElementById('detail').style.display='none'">✕ 닫기</span>
  <h3 id="d-title"></h3>
  <div class="meta" id="d-meta"></div>
  <div class="sec">→ 가는 곳</div>
  <ul id="d-out"></ul>
  <div class="sec">← 오는 곳</div>
  <ul id="d-in"></ul>
</div>
<script>
(function () {
  if (typeof vis === 'undefined') {
    const err = document.getElementById('net-error');
    if (err) {
      err.classList.add('show');
      err.innerHTML = '<b>그래프 라이브러리 (vis-network) 로드 실패.</b><br>' +
        '브라우저 콘솔(F12)에 자세한 오류가 있을 수 있습니다. ' +
        '<code>/m/_arch/vis-network.min.js</code> 가 200 응답인지 네트워크 탭에서 확인해주세요.';
    }
    return;
  }
const ALL_NODES = ${JSON.stringify(visNodes)};
const ALL_EDGES = ${JSON.stringify(visEdges)};
const nodes = new vis.DataSet(ALL_NODES);
const edges = new vis.DataSet(ALL_EDGES);
const container = document.getElementById('net');
const network = new vis.Network(container, { nodes, edges }, {
  layout: { improvedLayout: false },
  physics: { stabilization: { iterations: 250 }, barnesHut: { gravitationalConstant: -3500, springLength: 130, springConstant: 0.04 } },
  interaction: { hover: true, multiselect: true, tooltipDelay: 200, navigationButtons: true },
  groups: {
    mobile:    { color: { background: '#FED7AA', border: '#F59E0B' }, shape: 'box', font: { size: 12, face: 'sans-serif', bold: true } },
    'app-page':{ color: { background: '#BBF7D0', border: '#22C55E' }, shape: 'box', font: { size: 12, face: 'sans-serif', bold: true } },
    api:       { color: { background: '#DBEAFE', border: '#3B82F6' }, shape: 'ellipse', font: { size: 11, face: 'monospace' } },
  },
});

network.on('selectNode', (params) => {
  const id = params.nodes[0];
  const n = nodes.get(id);
  const detail = document.getElementById('detail');
  document.getElementById('d-title').textContent = n.label;
  document.getElementById('d-meta').textContent = n.title || '';
  const outgoing = ALL_EDGES.filter(e => e.from === id);
  const incoming = ALL_EDGES.filter(e => e.to === id);
  const $out = document.getElementById('d-out');
  const $in = document.getElementById('d-in');
  const fmt = (e, dir) => '<li>' + (nodes.get(dir === 'out' ? e.to : e.from)?.label || (dir === 'out' ? e.to : e.from)) + ' <small style="color:#999">(' + e.label + ')</small></li>';
  $out.innerHTML = outgoing.length ? outgoing.map(e => fmt(e, 'out')).join('') : '<li style="color:#999">없음</li>';
  $in.innerHTML = incoming.length ? incoming.map(e => fmt(e, 'in')).join('') : '<li style="color:#999">없음</li>';
  detail.style.display = 'block';
});

document.querySelectorAll('.topbar input[type=checkbox]').forEach(cb => {
  cb.addEventListener('change', () => {
    const visible = new Set([...document.querySelectorAll('.topbar input[type=checkbox]:checked')].map(x => x.dataset.group));
    const showIds = new Set(ALL_NODES.filter(n => visible.has(n.group)).map(n => n.id));
    nodes.update(ALL_NODES.map(n => ({ id: n.id, hidden: !showIds.has(n.id) })));
    edges.update(ALL_EDGES.map(e => ({ id: e.id, hidden: !showIds.has(e.from) || !showIds.has(e.to) })));
  });
});

document.getElementById('search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) { network.fit({ animation: true }); return; }
  const matches = ALL_NODES.filter(n => n.label.toLowerCase().includes(q));
  if (matches.length > 0) {
    network.selectNodes(matches.map(n => n.id));
    network.fit({ nodes: matches.map(n => n.id), animation: { duration: 400 } });
  }
});

// 안정화 완료 신호 → "로딩 중" 오버레이 제거
network.once('stabilizationIterationsDone', () => {
  container.classList.add('ready');
});
// 안정화가 안 끝나도 8초 후엔 강제로 표시
setTimeout(() => { container.classList.add('ready'); }, 8000);
})();
</script>
</body>
</html>
`

fs.writeFileSync(path.join(MAP_DIR, "map.html"), html, "utf8")

// .md 파일도 _arch/ 에 복사 — 모바일에서 https://nox.ai.kr/m/_arch/sitemap.md 로 접근 가능하게
fs.copyFileSync(path.join(ARCH_DIR, "sitemap.md"), path.join(MAP_DIR, "sitemap.md"))
fs.copyFileSync(path.join(ARCH_DIR, "api-graph.md"), path.join(MAP_DIR, "api-graph.md"))

// ───────── 콘솔 요약 ─────────
console.log("Generated:")
console.log(`  _arch/sitemap.md           ${mobileFiles.length} mobile · ${appPageFiles.length} app pages`)
console.log(`  _arch/api-graph.md         ${byCaller.size} callers · ${apiPathSet.size} endpoints`)
console.log(`  public/m/_arch/map.html    ${visNodes.length} nodes · ${visEdges.length} edges`)
console.log("")
console.log("Issues:")
console.log(`  dead links:        ${new Set(issues.deadLinks).size}`)
console.log(`  orphan pages:      ${issues.orphans.length}`)
console.log(`  unused endpoints:  ${issues.unusedEndpoints.length}`)
console.log(`  cycles:            ${issues.cycles.length}`)
