/**
 * Hand-off 페이지 상세 — UI / API / DB / 컴포넌트 / 흐름.
 *   /handoff/page?route=/m/staff
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
  imports: string[]
}
type ApiRoute = {
  file: string
  route: string
  methods: string[]
  tables: string[]
  line_count: number
}
type PageMeta = {
  title: string
  category: string
  summary: string
  ui_flow?: string[]
  permissions?: string
  edge_cases?: string[]
}

async function loadData() {
  const root = process.cwd()
  const auto = JSON.parse(
    await fs.readFile(path.join(root, "handoff/data/pages.json"), "utf8"),
  ) as { pages: PageData[]; api_routes: ApiRoute[]; tables: string[] }
  const meta = JSON.parse(
    await fs.readFile(path.join(root, "handoff/data/pages-meta.json"), "utf8"),
  ) as { pages: Record<string, PageMeta> }
  return { auto, meta }
}

async function guard() {
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
    if ((e as { digest?: string })?.digest?.startsWith?.("NEXT_REDIRECT")) throw e
    redirect("/login?next=/handoff")
  }
}

export default async function HandoffPageDetail({
  searchParams,
}: {
  searchParams: Promise<{ route?: string }>
}) {
  await guard()
  const sp = await searchParams
  const route = sp.route ?? "/m"
  const { auto, meta } = await loadData()
  const page = auto.pages.find((p) => p.route === route)
  const m = meta.pages[route]

  if (!page) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 32 }}>
        <Link href="/handoff" style={{ color: "#A87D45", textDecoration: "none" }}>← Hand-off</Link>
        <h1 style={{ marginTop: 16 }}>{route}</h1>
        <p style={{ color: "#7A746A" }}>이 페이지는 정의되지 않았습니다.</p>
      </div>
    )
  }

  // 이 페이지에서 호출하는 API 들의 상세 (DB 테이블 정보)
  const usedApis = page.apis.map((apiPath) => {
    // {[param]} 정규화 — API route 비교용
    const norm = apiPath.replace(/\$\{[^}]+\}/g, "[param]")
    const match = auto.api_routes.find((r) => {
      const rNorm = r.route.replace(/\[[^\]]+\]/g, "[param]")
      return rNorm === norm || rNorm === apiPath
    })
    return { path: apiPath, route: match }
  })

  // 모든 사용 테이블 합집합
  const usedTables = new Set<string>()
  for (const u of usedApis) {
    if (u.route) for (const t of u.route.tables) usedTables.add(t)
  }

  const screenshotPath = `/handoff/screens/${route.replace(/[^a-z0-9]/gi, "_")}.png`

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 64px" }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/handoff" style={{ color: "#A87D45", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
          ← Hand-off 인덱스
        </Link>
      </div>

      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "#A87D45", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>
          {m?.category ?? "기타"}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 8px 0" }}>
          {m?.title ?? route}
        </h1>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#7A746A" }}>
          {route} <span style={{ marginLeft: 8, color: "#A87D45" }}>· {page.file}</span>
        </div>
        {m?.summary && (
          <p style={{ fontSize: 14, color: "#2D2B26", lineHeight: 1.6, marginTop: 12 }}>
            {m.summary}
          </p>
        )}
        {m?.permissions && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <b>권한:</b> <span style={{ color: "#A87D45" }}>{m.permissions}</span>
          </div>
        )}
      </header>

      {/* 스크린샷 */}
      <Section title="📱 스크린샷">
        <div style={{
          background: "#F5EFE3",
          border: "1px dashed #D8D2C8",
          borderRadius: 16,
          padding: 24,
          textAlign: "center",
          fontSize: 12,
          color: "#7A746A",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotPath}
            alt={`${m?.title ?? route} screenshot`}
            style={{ maxWidth: 380, width: "100%", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
          <div style={{ marginTop: 12 }}>
            ⚠ 스크린샷 미생성. <code>node scripts/capture-handoff-screenshots.mjs</code> 실행.
          </div>
        </div>
      </Section>

      {/* UI 흐름 */}
      {m?.ui_flow && m.ui_flow.length > 0 && (
        <Section title="🎯 UI 흐름">
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: "#2D2B26" }}>
            {m.ui_flow.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </Section>
      )}

      {/* Edge cases */}
      {m?.edge_cases && m.edge_cases.length > 0 && (
        <Section title="⚠ 엣지 케이스 / 주의">
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: "#2D2B26" }}>
            {m.edge_cases.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Section>
      )}

      {/* 사용 컴포넌트 */}
      <Section title={`🧩 사용 컴포넌트 (${page.components.length})`}>
        {page.components.length === 0 ? (
          <div style={{ color: "#7A746A", fontSize: 13 }}>(공용 컴포넌트 직접 import 없음)</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {page.components.map((c) => (
              <code key={c} style={{
                padding: "3px 8px",
                background: "#F5EFE3",
                border: "1px solid #D8D2C8",
                borderRadius: 6,
                fontSize: 12,
              }}>{c}</code>
            ))}
          </div>
        )}
      </Section>

      {/* 사용 hook */}
      <Section title={`🪝 사용 hook (${page.hooks.length})`}>
        {page.hooks.length === 0 ? (
          <div style={{ color: "#7A746A", fontSize: 13 }}>(custom hook 없음)</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {page.hooks.map((h) => (
              <code key={h} style={{
                padding: "3px 8px",
                background: "#FAF5EC",
                border: "1px solid #C49B61",
                borderRadius: 6,
                fontSize: 12,
                color: "#A87D45",
              }}>{h}</code>
            ))}
          </div>
        )}
      </Section>

      {/* 호출 API */}
      <Section title={`🌐 호출 API (${usedApis.length})`}>
        {usedApis.length === 0 ? (
          <div style={{ color: "#7A746A", fontSize: 13 }}>(API 호출 없음)</div>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#7A746A", borderBottom: "1px solid #D8D2C8" }}>
                <th style={{ padding: "6px 8px" }}>경로</th>
                <th style={{ padding: "6px 8px" }}>메서드</th>
                <th style={{ padding: "6px 8px" }}>DB 테이블</th>
              </tr>
            </thead>
            <tbody>
              {usedApis.map((u, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #EEE7DA" }}>
                  <td style={{ padding: "8px", fontFamily: "monospace" }}>{u.path}</td>
                  <td style={{ padding: "8px" }}>
                    {u.route ? u.route.methods.join(", ") : <span style={{ color: "#C53030" }}>?</span>}
                  </td>
                  <td style={{ padding: "8px", fontFamily: "monospace", fontSize: 11 }}>
                    {u.route ? u.route.tables.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 사용 DB 테이블 */}
      <Section title={`🗄 사용 DB 테이블 (${usedTables.size})`}>
        {usedTables.size === 0 ? (
          <div style={{ color: "#7A746A", fontSize: 13 }}>(DB 직접 사용 없음)</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Array.from(usedTables).sort().map((t) => (
              <code key={t} style={{
                padding: "3px 8px",
                background: "#E8F4EC",
                border: "1px solid #82C8A0",
                borderRadius: 6,
                fontSize: 12,
                color: "#1F7A4F",
              }}>{t}</code>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: "white",
      border: "1px solid #D8D2C8",
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 12px 0" }}>{title}</h3>
      {children}
    </section>
  )
}
