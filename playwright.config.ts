/**
 * Playwright E2E 설정. 2026-04-25 (R23): 주요 플로우 회귀 자동 감지.
 *
 * 실행:
 *   npm run e2e               # headless, BASE_URL 기본 http://localhost:3000
 *   npm run e2e:ui            # UI mode (디버깅)
 *   BASE_URL=https://staging.example.com npm run e2e
 *
 * 환경 변수 (선택):
 *   BASE_URL              — 테스트 대상 (기본 http://localhost:3000)
 *   E2E_OWNER_EMAIL       — owner 계정 (없으면 auth/full-flow 테스트 skip)
 *   E2E_OWNER_PASSWORD
 *   E2E_MANAGER_EMAIL
 *   E2E_MANAGER_PASSWORD
 *
 * 로컬에서 dev 서버 자동 기동: webServer 항목.
 *   외부 URL 테스트 시 SKIP_WEBSERVER=1 로 비활성화.
 */

import { defineConfig, devices } from "@playwright/test"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
const SKIP_WEBSERVER = process.env.SKIP_WEBSERVER === "1" || BASE_URL !== "http://localhost:3000"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // 모바일 카운터 PC 흔치 않음 — 데스크톱만 우선. 필요 시 mobile-chrome 추가.
  ],

  webServer: SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
})
