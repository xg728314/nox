/**
 * Smoke — 공개 페이지 렌더 + 인증 가드 동작.
 *
 * R23: 배포 직후 5초 안에 "최소한 죽지 않았다" 를 확인.
 * 환경 변수 불필요 — CI 의 가장 첫 게이트.
 */

import { test, expect } from "@playwright/test"

test.describe("smoke — public pages", () => {
  test("루트 / → 로그인으로 리다이렉트되거나 200", async ({ page }) => {
    const response = await page.goto("/")
    // 로그인 미들웨어 체인에 따라 200/302 모두 허용. 5xx 만 실패.
    expect(response?.status() ?? 0).toBeLessThan(500)
  })

  test("/login 렌더 + 이메일/비밀번호 입력 표시", async ({ page }) => {
    await page.goto("/login")
    // 로그인 페이지 어딘가에 email / password 입력이 있어야 한다.
    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    const pwInput = page.locator('input[type="password"]').first()
    await expect(emailInput).toBeVisible()
    await expect(pwInput).toBeVisible()
  })

  test("/help 렌더 (비로그인 fallback 카피 노출)", async ({ page }) => {
    await page.goto("/help")
    await expect(page.getByText("사용 가이드")).toBeVisible()
  })

  test("보호 라우트 /counter 비로그인 차단", async ({ page }) => {
    const r = await page.goto("/counter")
    // 비로그인은 /login 으로 튀거나, 클라이언트 가드로 머무는 동안 인증 화면 노출.
    // 어느 쪽이든 "체크인" 같은 카운터 핵심 UI 가 노출되면 안 된다.
    expect(r?.status() ?? 0).toBeLessThan(500)
    const url = page.url()
    const onLogin = /\/login/.test(url)
    const counterReady = await page.getByText("체크인").isVisible().catch(() => false)
    expect(onLogin || !counterReady).toBe(true)
  })

  test("404 페이지", async ({ page }) => {
    const r = await page.goto("/__definitely_does_not_exist__")
    expect([404, 200]).toContain(r?.status() ?? 0)
  })
})

test.describe("smoke — security headers", () => {
  test("프로덕션 권장 헤더 존재", async ({ request }) => {
    const r = await request.get("/login")
    const h = r.headers()
    // next.config.ts 에서 적용한 헤더 — dev 환경에서도 동일 적용됨.
    expect(h["x-frame-options"]).toBe("DENY")
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(h["referrer-policy"]).toBeTruthy()
  })
})
