#!/usr/bin/env node
/**
 * 모바일 앱 (/m/*.html) 스크린샷 자동 캡쳐
 *
 * 동작:
 *   1. 로컬 정적 HTTP 서버 (localhost:8765) 로 public/m/ 서빙
 *   2. Playwright chromium 으로 각 페이지 방문 (390x844 iPhone 14 viewport)
 *   3. NoxAPI 호출은 fail → 페이지의 mock fallback UI 캡쳐 (구조 파악 용도)
 *   4. public/m/_arch/screens/{name}.png 저장
 *
 * 실행:
 *   node scripts/capture-mobile-screens.mjs
 */
import { chromium } from "playwright"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const MOBILE_DIR = path.join(ROOT, "public/m")
const SCREENS_DIR = path.join(MOBILE_DIR, "_arch/screens")

const PORT = 8765
const VIEWPORT = { width: 390, height: 844 } // iPhone 14
const DEVICE_SCALE = 2

// MIME 타입
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
}

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // 요청 URL 파싱 (?staff=foo 같은 쿼리 무시)
      let urlPath = (req.url || "/").split("?")[0]
      // /m/index.html → /index.html (MOBILE_DIR 가 /m/ 역할)
      if (urlPath.startsWith("/m/")) urlPath = urlPath.slice(2)
      if (urlPath === "/") urlPath = "/index.html"

      const filePath = path.join(MOBILE_DIR, urlPath)
      // 디렉터리 traversal 방어
      if (!filePath.startsWith(MOBILE_DIR)) {
        res.writeHead(403); res.end("forbidden"); return
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // /api/* 등 모바일 page 가 호출하는 endpoint → 404 (페이지의 mock fallback 트리거)
          res.writeHead(404, { "content-type": "text/plain" })
          res.end("not found")
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" })
        res.end(data)
      })
    })
    server.listen(PORT, "127.0.0.1", () => resolve(server))
  })
}

async function main() {
  fs.mkdirSync(SCREENS_DIR, { recursive: true })

  // 캡쳐 대상: /m/*.html (단 _arch 하위는 제외)
  const pages = fs
    .readdirSync(MOBILE_DIR)
    .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
    .sort()

  console.log(`Capturing ${pages.length} pages...`)

  const server = await startLocalServer()
  console.log(`Local server: http://127.0.0.1:${PORT}/`)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  })

  // /api/* 호출은 항상 401로 즉시 응답 → 페이지의 mock fallback 빠르게 트리거
  await context.route("**/api/**", (route) => {
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"AUTH_MISSING"}' })
  })

  const page = await context.newPage()

  const results = []
  for (const file of pages) {
    const url = `http://127.0.0.1:${PORT}/${file}`
    process.stdout.write(`  ${file}... `)
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
      // 페이지 JS 가 mock fallback 까지 가도록 대기
      await page.waitForTimeout(1500)
      const outPath = path.join(SCREENS_DIR, file.replace(".html", ".png"))
      await page.screenshot({ path: outPath, fullPage: false })
      results.push({ file, ok: true, path: outPath })
      console.log("✓")
    } catch (e) {
      results.push({ file, ok: false, error: e.message })
      console.log("✗", e.message.slice(0, 60))
    }
  }

  await browser.close()
  server.close()

  console.log(
    `\nCaptured ${results.filter((r) => r.ok).length}/${results.length} pages → ${path.relative(ROOT, SCREENS_DIR)}/`,
  )
  // 실패한 페이지만 다시 출력
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.log("Failed:")
    for (const r of failed) console.log(`  ${r.file}: ${r.error}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
