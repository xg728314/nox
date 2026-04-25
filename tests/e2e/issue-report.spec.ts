/**
 * Issue Report — 🐞 버튼 회귀 방지.
 *
 * R23: 사용자가 버그 신고할 통로가 막히면 우리는 눈을 잃는다.
 *
 * 비로그인 상태: 버튼 안 보여야 함 (R18-1 회귀 가드).
 * 로그인 상태: 버튼 → 모달 → 제출 흐름이 적어도 "열린다" 까지는 확인.
 */

import { test, expect } from "@playwright/test"

const EMAIL = process.env.E2E_MANAGER_EMAIL
const PASSWORD = process.env.E2E_MANAGER_PASSWORD

test.describe("issue report 🐞", () => {
  test("비로그인 — 버튼 노출 없음", async ({ page }) => {
    await page.goto("/help")
    // 🐞 이모지 버튼은 IssueReportButton 에서만 사용. 다른 곳에 같은 이모지 X.
    const bug = page.getByRole("button", { name: /🐞/ })
    await expect(bug).toHaveCount(0)
  })

  test.describe("로그인 (E2E_MANAGER_* 필요)", () => {
    test.skip(!EMAIL || !PASSWORD, "E2E_MANAGER_* not set")

    test("로그인 후 — 버튼 노출 + 모달 오픈", async ({ page }) => {
      await page.goto("/login")
      await page.locator('input[type="email"]').first().fill(EMAIL!)
      await page.locator('input[type="password"]').first().fill(PASSWORD!)
      await page.getByRole("button", { name: /로그인$/ }).click()
      await page.waitForURL(/\/(counter|manager|owner|me)/, { timeout: 15_000 })

      const bug = page.getByRole("button", { name: /🐞/ }).first()
      await expect(bug).toBeVisible({ timeout: 10_000 })
      await bug.click()

      // 모달 안에 제목/설명 입력칸이 떠야 한다.
      await expect(page.getByText(/제목|설명|신고/).first()).toBeVisible({ timeout: 5_000 })
    })
  })
})
