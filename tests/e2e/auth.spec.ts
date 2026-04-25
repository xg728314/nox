/**
 * Auth — 로그인 플로우.
 *
 * R23: 로그인 깨지면 모든 게 멈춘다. 가장 보호해야 할 회귀 지점.
 *
 * E2E_OWNER_EMAIL/PASSWORD 가 없으면 skip — CI 외부에서는 자동 통과.
 */

import { test, expect } from "@playwright/test"

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD

test.describe("auth — 로그인", () => {
  test("잘못된 비밀번호 → 에러 노출, 보호 라우트 진입 불가", async ({ page }) => {
    await page.goto("/login")
    await page.locator('input[type="email"]').first().fill("wrong@nox-test.com")
    await page.locator('input[type="password"]').first().fill("definitely-wrong-password")
    await page.getByRole("button", { name: /로그인$/ }).click()

    // 어떤 에러 메시지든 노출돼야 한다 (정확한 카피는 회귀 시 자주 바뀜).
    await expect(page.locator('p.text-red-400, [role="alert"], .text-red-400').first())
      .toBeVisible({ timeout: 10_000 })

    // 카운터로 진입했으면 안 된다.
    expect(page.url()).not.toMatch(/\/counter/)
  })

  test.describe("seed 계정 사용 가능 (E2E_OWNER_* 필요)", () => {
    test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, "E2E owner credentials not set")

    test("owner 로그인 → 보호 라우트 접근 가능", async ({ page }) => {
      await page.goto("/login")
      await page.locator('input[type="email"]').first().fill(OWNER_EMAIL!)
      await page.locator('input[type="password"]').first().fill(OWNER_PASSWORD!)
      await page.getByRole("button", { name: /로그인$/ }).click()

      // MFA 미사용 owner 가정. MFA 활성 환경이면 별도 시나리오.
      // 로그인 후 어디론가 이동해야 한다 (대시보드/카운터/사장 등).
      await page.waitForURL(/\/(counter|owner|manager|me|settlement)/, { timeout: 15_000 })

      // 사이드바 또는 핵심 메뉴 노출 확인 — role 별 접근권 일부 확인.
      const ok = await Promise.race([
        page.getByText("카운터").isVisible().catch(() => false),
        page.getByText("정산").isVisible().catch(() => false),
        page.getByText("매장관리").isVisible().catch(() => false),
      ])
      expect(ok).toBe(true)
    })

    test("로그인 직후 새로고침해도 세션 유지", async ({ page }) => {
      await page.goto("/login")
      await page.locator('input[type="email"]').first().fill(OWNER_EMAIL!)
      await page.locator('input[type="password"]').first().fill(OWNER_PASSWORD!)
      await page.getByRole("button", { name: /로그인$/ }).click()
      await page.waitForURL(/\/(counter|owner|manager|me|settlement)/, { timeout: 15_000 })

      const after = page.url()
      await page.reload()
      // 새로고침 후에도 같은 보호 라우트에 머물러야 한다 (HttpOnly 쿠키 유지).
      await page.waitForURL(after, { timeout: 10_000 }).catch(() => null)
      expect(page.url()).not.toMatch(/\/login$/)
    })
  })

  test.describe("manager 로그인 (E2E_MANAGER_* 필요)", () => {
    test.skip(!MANAGER_EMAIL || !MANAGER_PASSWORD, "E2E manager credentials not set")

    test("manager 도 동일 플로우로 로그인", async ({ page }) => {
      await page.goto("/login")
      await page.locator('input[type="email"]').first().fill(MANAGER_EMAIL!)
      await page.locator('input[type="password"]').first().fill(MANAGER_PASSWORD!)
      await page.getByRole("button", { name: /로그인$/ }).click()
      await page.waitForURL(/\/(counter|manager|me)/, { timeout: 15_000 })
      expect(page.url()).not.toMatch(/\/login$/)
    })
  })
})
