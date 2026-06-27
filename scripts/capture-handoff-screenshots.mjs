#!/usr/bin/env node
/**
 * Playwright 자동 스크린샷 캡쳐 — Hand-off 페이지용.
 *
 * 출력: public/handoff/screens/{route_slug}.png
 *
 * 사용:
 *   1. npx playwright install chromium  (최초 1회)
 *   2. BASE_URL=https://nox.ai.kr ACCESS_TOKEN=eyJ... node scripts/capture-handoff-screenshots.mjs
 *      또는 로컬:
 *      BASE_URL=http://localhost:3000 ACCESS_TOKEN=eyJ... node scripts/capture-handoff-screenshots.mjs
 *
 * 토큰 획득:
 *   - 브라우저 로그인 후 DevTools → Application → Cookies → sb-access-token 값 복사
 *   - 또는 /api/auth/login 호출 후 access_token 사용
 *
 * 동작:
 *   - handoff/data/pages.json 의 routes 순회
 *   - 모바일 viewport (390×844) — iPhone 14 base
 *   - 각 페이지 full-page screenshot
 *   - 5초 대기 (데이터 로드)
 *
 * 주의:
 *   - 인증 필요한 페이지는 ACCESS_TOKEN 없으면 /login 으로 redirect → 빈 화면.
 *   - super_admin token 사용 권장 (모든 페이지 접근).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const OUT_DIR = path.join(ROOT, "public/handoff/screens")
const DATA_FILE = path.join(ROOT, "handoff/data/pages.json")

const BASE = process.env.BASE_URL || "http://localhost:3000"
const TOKEN = process.env.ACCESS_TOKEN
if (!TOKEN) {
  console.error("⚠ ACCESS_TOKEN 환경 변수 필요. (sb-access-token cookie 값)")
  process.exit(1)
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Playwright dynamic import — 설치 안 됐으면 친절 메시지
  let chromium
  try {
    ({ chromium } = await import("playwright"))
  } catch {
    console.error("⚠ playwright 미설치. 실행:")
    console.error("    npm i -D playwright && npx playwright install chromium")
    process.exit(1)
  }

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  })

  // 인증 cookie
  const url = new URL(BASE)
  await ctx.addCookies([{
    name: "sb-access-token",
    value: TOKEN,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: url.protocol === "https:",
  }])

  const page = await ctx.newPage()

  let ok = 0, fail = 0
  for (const p of data.pages) {
    const slug = p.route.replace(/[^a-z0-9]/gi, "_")
    const outFile = path.join(OUT_DIR, `${slug}.png`)
    const fullUrl = BASE + p.route.replace(/\[([^\]]+)\]/g, (_, k) => `__${k}__`)
    try {
      console.log(`→ ${p.route}`)
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      await page.waitForTimeout(2500)  // 데이터 로드
      await page.screenshot({ path: outFile, fullPage: true })
      ok++
    } catch (e) {
      console.error(`  ✗ ${p.route}: ${e.message}`)
      fail++
    }
  }
  await browser.close()
  console.log(`\n✓ ${ok}건 캡쳐 / ${fail}건 실패 → ${OUT_DIR}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
