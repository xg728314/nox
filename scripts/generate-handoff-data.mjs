#!/usr/bin/env node
/**
 * Hand-off 데이터 자동 추출.
 *
 * 출력: handoff/data/pages.json
 *   각 페이지마다 — 라우트, 사용 컴포넌트, 호출 API, 사용 hook, import 들.
 *
 * 사용:
 *   node scripts/generate-handoff-data.mjs
 *
 * 결합: handoff/data/pages-meta.json (수동 보강) 과 합쳐 /handoff 페이지에 표시.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const APP_DIR = path.join(ROOT, "app")
const OUT_DIR = path.join(ROOT, "handoff/data")

// 분석할 페이지 경로 (Next.js (app) route 변환)
const PAGE_GLOBS = [
  "m/(app)/page.tsx",
  "m/(app)/**/page.tsx",
  "m/monitor/page.tsx",
  "m/monitor/**/page.tsx",
]

function listPages() {
  const out = []
  function walk(dir, rel = "") {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const relPath = path.join(rel, entry.name)
      if (entry.isDirectory()) {
        walk(full, relPath)
      } else if (entry.name === "page.tsx" && relPath.startsWith("m" + path.sep)) {
        out.push({ file: full, rel: relPath })
      }
    }
  }
  walk(APP_DIR)
  return out
}

// Next.js URL 추출 — (app) 같은 group 제거, [id] 유지
function routeFromFile(rel) {
  // remove /page.tsx
  let r = rel.replace(/page\.tsx$/, "").replace(/\\/g, "/")
  if (r.endsWith("/")) r = r.slice(0, -1)
  // remove (group) segments
  r = r.split("/").filter((seg) => !(seg.startsWith("(") && seg.endsWith(")"))).join("/")
  return "/" + r
}

// import 추출
function extractImports(src) {
  const re = /import\s+(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out
}

// apiFetch / fetch 패턴에서 API 라우트 추출
function extractApiCalls(src) {
  const out = new Set()
  const patterns = [
    /apiFetch\(\s*[`"'](\/api\/[^`"'$\s]+)/g,
    /fetch\(\s*[`"'](\/api\/[^`"'$\s]+)/g,
    /useApi[^(]*\(\s*[`"'](\/api\/[^`"'$\s]+)/g,
    /invalidateApi\(\s*[`"'](\/api\/[^`"'$\s]+)/g,
  ]
  for (const p of patterns) {
    let m
    while ((m = p.exec(src)) !== null) {
      // 단순화: ${} 인터폴레이션은 [param] 으로 표시
      const route = m[1].replace(/\?.*$/, "")
      out.add(route)
    }
  }
  return Array.from(out).sort()
}

// useMobileData hook 추출
function extractHooks(src) {
  const out = new Set()
  const re = /\b(use[A-Z]\w+)\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    if (["useState","useEffect","useMemo","useCallback","useRef","useRouter","useParams","useSearchParams","useToast"].includes(m[1])) continue
    out.add(m[1])
  }
  return Array.from(out).sort()
}

// 컴포넌트 import 추출 (Sheet / Card / Bar / Cell 등 패턴)
function extractComponents(src) {
  const re = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+_components[^"']*)["']/g
  const out = new Set()
  let m
  while ((m = re.exec(src)) !== null) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
    for (const n of names) {
      if (/^[A-Z]/.test(n)) out.add(n)
    }
  }
  return Array.from(out).sort()
}

const pages = listPages().map(({ file, rel }) => {
  const src = fs.readFileSync(file, "utf8")
  return {
    file: rel.replace(/\\/g, "/"),
    route: routeFromFile(rel),
    apis: extractApiCalls(src),
    hooks: extractHooks(src).filter((h) => h.startsWith("use") && h !== "use" && !/^use[A-Z][a-z]+$/i.test(h) || h.length > 4),
    components: extractComponents(src),
    line_count: src.split("\n").length,
    imports: extractImports(src),
  }
}).sort((a, b) => a.route.localeCompare(b.route))

// API 라우트 자동 분석 — 각 API 의 DB 테이블 사용 추출
function listApiRoutes() {
  const out = []
  function walk(dir, rel = "") {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const relPath = path.join(rel, entry.name)
      if (entry.isDirectory()) walk(full, relPath)
      else if (entry.name === "route.ts" || entry.name === "route.tsx") {
        out.push({ file: full, rel: relPath })
      }
    }
  }
  walk(path.join(APP_DIR, "api"))
  return out
}

function extractTables(src) {
  const out = new Set()
  // .from("table_name") 패턴 + .from('table')
  const re = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/gi
  let m
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return Array.from(out).sort()
}

function extractHttpMethods(src) {
  const out = new Set()
  for (const verb of ["GET","POST","PATCH","PUT","DELETE"]) {
    if (new RegExp(`export\\s+async\\s+function\\s+${verb}\\b`).test(src)) out.add(verb)
  }
  return Array.from(out)
}

function routeFromApi(rel) {
  let r = rel.replace(/route\.(ts|tsx)$/, "").replace(/\\/g, "/")
  if (r.endsWith("/")) r = r.slice(0, -1)
  return "/api/" + r
}

const apiRoutes = listApiRoutes().map(({ file, rel }) => {
  const src = fs.readFileSync(file, "utf8")
  return {
    file: ("api/" + rel).replace(/\\/g, "/"),
    route: routeFromApi(rel),
    methods: extractHttpMethods(src),
    tables: extractTables(src),
    line_count: src.split("\n").length,
  }
}).sort((a, b) => a.route.localeCompare(b.route))

// DB 테이블 인벤토리 — 모든 API 에서 사용되는 테이블 집합
const allTables = new Set()
for (const r of apiRoutes) for (const t of r.tables) allTables.add(t)

// 출력
fs.mkdirSync(OUT_DIR, { recursive: true })
const outFile = path.join(OUT_DIR, "pages.json")
const data = {
  generated_at: new Date().toISOString(),
  page_count: pages.length,
  api_count: apiRoutes.length,
  table_count: allTables.size,
  pages,
  api_routes: apiRoutes,
  tables: Array.from(allTables).sort(),
}
fs.writeFileSync(outFile, JSON.stringify(data, null, 2))
console.log(`✓ ${pages.length} pages, ${apiRoutes.length} API routes, ${allTables.size} tables → ${outFile}`)
