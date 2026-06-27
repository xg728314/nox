/**
 * Hand-off 인덱스 — 페이지 카드 그리드 + 카테고리 필터.
 *   /handoff
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import Link from "next/link"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

type PageData = {
  file: string
  route: string
  apis: string[]
  hooks: string[]
  components: string[]
  line_count: number
}
type ApiRoute = {
  route: string
  methods: string[]
  tables: string[]
  line_count: number
}
type AutoData = {
  generated_at: string
  pages: PageData[]
  api_routes: ApiRoute[]
  tables: string[]
  page_count: number
  api_count: number
  table_count: number
}
type PageMeta = {
  title: string
  category: string
  summary: string
  ui_flow?: string[]
  permissions?: string
  edge_cases?: string[]
}
type MetaData = { pages: Record<string, PageMeta> }

async function loadData() {
  const root = process.cwd()
  const auto = JSON.parse(
    await fs.readFile(path.join(root, "handoff/data/pages.json"), "utf8"),
  ) as AutoData
  const meta = JSON.parse(
    await fs.readFile(path.join(root, "handoff/data/pages-meta.json"), "utf8"),
  ) as MetaData
  return { auto, meta }
}

async function guard() {
  // super_admin 만 접근.
  try {
    const h = await headers()
    const c = await cookies()
    const cookieHeader = c.getAll().map(({ name, value }) => `${name}=${value}`).join("; ")
    const reqHeaders = new Headers()
    h.forEach((v, k) => reqHeaders.set(k, v))
    if (cookieHeader) reqHeaders.set("cookie", cookieHeader)
    const req = new Request("https://localhost/handoff", { headers: reqHeaders })
    const auth = await resolveAuthContext(req)
    if (!auth.is_super_admin) redirect("/m")
  } catch (e) {
    // redirect() throws — re-throw 로 Next.js navigation 처리
    if ((e as { digest?: string })?.digest?.startsWith?.("NEXT_REDIRECT")) throw e
    redirect("/login?next=/handoff")
  }
}

export default async function HandoffIndexPage() {
  await guard()
  const { auto, meta } = await loadData()

  // 카테고리별 그룹화
  const groups = new Map<string, Array<{ data: PageData; meta?: PageMeta }>>()
  for (const p of auto.pages) {
    const m = meta.pages[p.route]
    const cat = m?.category ?? "기타"
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push({ data: p, meta: m })
  }
  const sortedCats = ["홈", "스태프", "메이드 등록", "채팅", "정산", "매장", "관제", "내정보", "기타"]
    .filter((c) => groups.has(c))

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
          NOX Hand-off
        </h1>
        <p style={{ fontSize: 14, color: "#7A746A", margin: "6px 0 0 0" }}>
          외부 개발자용 페이지별 spec — UI / API / DB / 동작 흐름.
        </p>
        <div style={{ marginTop: 12, fontSize: 12, color: "#7A746A" }}>
          <b>{auto.page_count}</b> pages · <b>{auto.api_count}</b> API routes · <b>{auto.table_count}</b> DB tables
          {" · "}
          업데이트: {new Date(auto.generated_at).toISOString().slice(0, 16).replace("T", " ")} UTC
        </div>
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
        {sortedCats.map((c) => (
          <a
            key={c}
            href={`#cat-${encodeURIComponent(c)}`}
            style={{
              display: "inline-block",
              padding: "6px 12px",
              borderRadius: 999,
              background: "white",
              border: "1px solid #D8D2C8",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              color: "#2D2B26",
            }}
          >
            {c} · {groups.get(c)!.length}
          </a>
        ))}
      </nav>

      {sortedCats.map((cat) => (
        <section key={cat} id={`cat-${encodeURIComponent(cat)}`} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 12px 0" }}>{cat}</h2>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            {groups.get(cat)!.map(({ data, meta: m }) => (
              <Link
                key={data.route}
                href={`/handoff/page?route=${encodeURIComponent(data.route)}`}
                style={{
                  display: "block",
                  background: "white",
                  border: "1px solid #D8D2C8",
                  borderRadius: 16,
                  padding: 16,
                  textDecoration: "none",
                  color: "#2D2B26",
                  transition: "box-shadow 0.15s",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
                  {m?.title ?? data.route}
                </div>
                <div style={{ fontSize: 11, color: "#A87D45", fontFamily: "monospace", marginBottom: 8 }}>
                  {data.route}
                </div>
                {m?.summary && (
                  <div style={{ fontSize: 12, color: "#7A746A", lineHeight: 1.5, marginBottom: 8 }}>
                    {m.summary}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <Tag>{data.apis.length} API</Tag>
                  <Tag>{data.components.length} 컴포넌트</Tag>
                  <Tag>{data.line_count}줄</Tag>
                  {m?.permissions && <Tag tone="auth">{m.permissions}</Tag>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <footer style={{ marginTop: 48, padding: "16px 0", borderTop: "1px solid #D8D2C8", fontSize: 11, color: "#7A746A" }}>
        자동 생성: <code>node scripts/generate-handoff-data.mjs</code>
        {" · "}
        스크린샷: <code>node scripts/capture-handoff-screenshots.mjs</code> (TODO)
      </footer>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "auth" }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      background: tone === "auth" ? "#FAF5EC" : "#F5EFE3",
      border: `1px solid ${tone === "auth" ? "#C49B61" : "#D8D2C8"}`,
      fontSize: 10,
      fontWeight: 700,
      color: tone === "auth" ? "#A87D45" : "#7A746A",
    }}>
      {children}
    </span>
  )
}
