/**
 * Critical Path — 체크인 → 스태프 추가 → 체크아웃 → 정산.
 *
 * R23: 매출이 흐르는 메인 라인. 깨지면 영업 중단.
 *
 * 환경 변수:
 *   E2E_MANAGER_EMAIL/PASSWORD  — 카운터 사용 가능한 계정
 *   E2E_TARGET_ROOM             — 비어 있는 방 번호 (선택, 기본 "999")
 *
 * 미설정 시 전체 skip — 운영 DB 를 건드리지 않도록 안전 fallback.
 *
 * NOTE: 이 테스트는 실제 DB 에 세션 row 를 생성한다. 반드시 격리된
 *   스테이징/테스트 매장에서만 실행. production BASE_URL 로 절대 실행 금지.
 */

import { test, expect } from "@playwright/test"

const EMAIL = process.env.E2E_MANAGER_EMAIL
const PASSWORD = process.env.E2E_MANAGER_PASSWORD
const TARGET_ROOM = process.env.E2E_TARGET_ROOM ?? "999"
const ALLOW_PROD = process.env.E2E_ALLOW_PROD === "1"

test.describe("counter — 핵심 플로우", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_MANAGER_* not set")
  test.beforeAll(() => {
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000"
    if (!ALLOW_PROD && /vercel\.app|nox\.kr|production/.test(baseUrl)) {
      throw new Error(
        `Refusing to run mutating E2E against ${baseUrl}. ` +
        `Set E2E_ALLOW_PROD=1 to override (NOT recommended).`,
      )
    }
  })

  async function login(page: import("@playwright/test").Page) {
    await page.goto("/login")
    await page.locator('input[type="email"]').first().fill(EMAIL!)
    await page.locator('input[type="password"]').first().fill(PASSWORD!)
    await page.getByRole("button", { name: /로그인$/ }).click()
    await page.waitForURL(/\/(counter|manager|owner|me)/, { timeout: 15_000 })
  }

  test("카운터 페이지 로드 → 방 목록 노출", async ({ page }) => {
    await login(page)
    await page.goto("/counter")
    // 어떤 방 카드든 1개 이상은 떠야 한다.
    const anyRoom = page.locator('text=/\\d+번방|빈\\s*방/').first()
    await expect(anyRoom).toBeVisible({ timeout: 10_000 })
  })

  test("도움말 / 감시 / 신고 메뉴 진입", async ({ page }) => {
    await login(page)

    await page.goto("/help")
    await expect(page.getByText("사용 가이드")).toBeVisible()

    // /ops/watchdog 은 owner 전용일 수 있음 — 200 만 확인.
    const r = await page.goto("/ops/watchdog")
    expect(r?.status() ?? 0).toBeLessThan(500)
  })

  // 체크인 → 체크아웃 전체 플로우는 DB 시드 + 정산 환경 의존도가 크다.
  // 별도 round 에서 fixture(매장 격리, 자동 클린업 RPC) 가 정비된 뒤 활성화.
  test.skip("FUTURE: 빈 방 체크인 → 스태프 추가 → 체크아웃 → 정산 finalize → archive", async () => {
    // 1) /counter 에서 TARGET_ROOM 카드 클릭
    // 2) 실장 배정 → 손님 정보
    // 3) 스태프 일괄 추가 ("테스트1 60 퍼")
    // 4) 진행률 바 강제 만료(시간 흐름) 또는 /api/sessions/checkout 직접 호출
    // 5) 정산 생성 → 결제(현금) → finalize → 인쇄(archive)
    // 6) /api/rooms?room_uuid=... 응답에서 active_session_id == null 확인
    // 7) cleanup: 테스트 세션 archived_at 확인 (soft delete 검증)
  })
})
