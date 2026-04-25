/**
 * NOX 세션 라이프사이클 쓰기 경로 부하 테스트.
 *
 * 시나리오:
 *   1. 체크인 (POST /api/sessions/checkin)
 *   2. 참여자 추가 (POST /api/sessions/participants)
 *   3. 참여자 완성 (PATCH) — category + time_minutes + manager_deduction
 *   4. 주문 추가 (POST /api/sessions/orders)
 *   5. 체크아웃 (POST /api/sessions/checkout)
 *   6. 정산 생성 (POST /api/sessions/settlement)
 *   7. 정산 확정 (POST /api/sessions/settlement/finalize)
 *   8. 결제 등록 (POST /api/sessions/settlement/payment)
 *
 * ⚠️  **절대 프로덕션 DB 에 실행 금지**. preview/staging 전용.
 *     실행 전 ALLOW_WRITE=1 환경변수 확인 — 없으면 즉시 중단.
 *
 * 실행:
 *   $env:BASE_URL="https://<preview>.vercel.app"
 *   $env:TOKEN="eyJ..."
 *   $env:ROOM_UUID="<비어있는 방 UUID>"
 *   $env:MANAGER_MEMBERSHIP_ID="<승인된 manager membership_id>"
 *   $env:HOSTESS_MEMBERSHIP_ID="<승인된 hostess membership_id>"
 *   $env:MENU_ITEM_ID="<inventory item id>"
 *   $env:ALLOW_WRITE=1
 *   k6 run scripts/load-test/k6-session-lifecycle.js
 *
 * 2026-04-25 작성. 쓰기 경로 baseline.
 *
 * Teardown: 각 iteration 은 자신이 만든 세션만 체크아웃 + 결제까지 완료.
 *   생성된 데이터는 archive 하지 않음 (사용자가 수동으로 확인 후 정리).
 *   단, k6 시나리오 자체는 완전한 end-to-end 흐름이라 세션이 "정상 종료"
 *   상태로 남음 → 운영 쿼리 필터에 영향 없음.
 */

import http from "k6/http"
import { check, sleep, fail } from "k6"
import { Rate, Trend } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const TOKEN    = __ENV.TOKEN || ""
const ROOM     = __ENV.ROOM_UUID || ""
const MGR      = __ENV.MANAGER_MEMBERSHIP_ID || ""
const HOSTESS  = __ENV.HOSTESS_MEMBERSHIP_ID || ""
const MENU     = __ENV.MENU_ITEM_ID || ""
const ALLOW    = __ENV.ALLOW_WRITE === "1"

if (!ALLOW) {
  throw new Error(
    "SAFETY GUARD: ALLOW_WRITE=1 env 가 없습니다. " +
    "쓰기 테스트는 preview/staging 에서만 실행. 프로덕션 DB 에 실행 금지.",
  )
}
if (!TOKEN || !ROOM || !MGR || !HOSTESS) {
  throw new Error("TOKEN, ROOM_UUID, MANAGER_MEMBERSHIP_ID, HOSTESS_MEMBERSHIP_ID 필수")
}

const errorRate = new Rate("errors")
const fullLifecycleTrend = new Trend("full_lifecycle_ms")
const stepTrends = {
  checkin:      new Trend("step_checkin_ms"),
  participant:  new Trend("step_participant_ms"),
  patch:        new Trend("step_patch_ms"),
  order:        new Trend("step_order_ms"),
  checkout:     new Trend("step_checkout_ms"),
  settlement:   new Trend("step_settlement_ms"),
  finalize:     new Trend("step_finalize_ms"),
  payment:      new Trend("step_payment_ms"),
}

// 공격적이지 않은 쓰기 부하 — 매장 전체 동시 checkout 시나리오 모사.
export const options = {
  scenarios: {
    lifecycle: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "2m",  target: 5 },   // 5 VU 지속 (동시 5 방 운영)
        { duration: "30s", target: 10 },
        { duration: "2m",  target: 10 },  // 10 VU 지속
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000", "p(99)<6000"],
    http_req_failed:   ["rate<0.02"],
    errors:            ["rate<0.02"],
    full_lifecycle_ms: ["p(95)<15000"],
  },
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
}

function post(path, body, tag) {
  const t0 = Date.now()
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers, tags: { name: tag } })
  const dt = Date.now() - t0
  if (stepTrends[tag]) stepTrends[tag].add(dt)
  return res
}

function patch(path, body, tag) {
  const t0 = Date.now()
  const res = http.patch(`${BASE_URL}${path}`, JSON.stringify(body), { headers, tags: { name: tag } })
  const dt = Date.now() - t0
  if (stepTrends[tag]) stepTrends[tag].add(dt)
  return res
}

export default function () {
  const lifecycleStart = Date.now()
  let ok = true

  // 1. 체크인
  const r1 = post("/api/sessions/checkin", {
    room_uuid: ROOM,
    manager_membership_id: MGR,
  }, "checkin")
  if (!check(r1, { "checkin 201": (r) => r.status === 201 })) {
    errorRate.add(1); ok = false
    return // 체크인 실패면 다음 스텝 무의미
  }
  const session_id = r1.json("session_id")
  if (!session_id) { errorRate.add(1); return }

  sleep(0.5)

  // 2. 참여자 추가 (완전한 형태로 바로 등록 — placeholder 스텝 생략)
  const r2 = post("/api/sessions/participants", {
    session_id,
    membership_id: HOSTESS,
    role: "hostess",
    category: "퍼블릭",
    time_minutes: 90,
    manager_deduction: 10000,
  }, "participant")
  ok = check(r2, { "participant 201": (r) => r.status === 201 }) && ok
  errorRate.add(!ok)

  sleep(0.5)

  // 3. 주문 추가 (MENU 제공된 경우만)
  if (MENU) {
    const r3 = post("/api/sessions/orders", {
      session_id,
      inventory_item_id: MENU,
      qty: 1,
    }, "order")
    check(r3, { "order 2xx": (r) => r.status >= 200 && r.status < 300 })
  }

  sleep(1)

  // 4. 체크아웃
  const r4 = post("/api/sessions/checkout", { session_id }, "checkout")
  ok = check(r4, { "checkout ok": (r) => r.status === 200 || r.status === 201 }) && ok
  errorRate.add(!ok)

  sleep(0.5)

  // 5. 정산 생성
  const r5 = post("/api/sessions/settlement", { session_id }, "settlement")
  ok = check(r5, { "settlement ok": (r) => r.status === 200 || r.status === 201 }) && ok
  errorRate.add(!ok)

  sleep(0.5)

  // 6. 정산 확정
  const r6 = post("/api/sessions/settlement/finalize", { session_id }, "finalize")
  ok = check(r6, { "finalize ok": (r) => r.status === 200 || r.status === 201 }) && ok

  sleep(0.3)

  // 7. 결제 (현금 단독)
  const grossTotal = r5.json("gross_total") || r6.json("gross_total") || 0
  if (grossTotal > 0) {
    const r7 = post("/api/sessions/settlement/payment", {
      session_id,
      payment_method: "cash",
      cash_amount: grossTotal,
      card_amount: 0,
      credit_amount: 0,
      manager_card_margin: 0,
    }, "payment")
    check(r7, { "payment ok": (r) => r.status === 200 || r.status === 201 })
  }

  const lifecycleDt = Date.now() - lifecycleStart
  fullLifecycleTrend.add(lifecycleDt)

  sleep(2 + Math.random() * 2)
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      full_lifecycle_ms: data.metrics.full_lifecycle_ms?.values,
      step_checkin_ms: data.metrics.step_checkin_ms?.values,
      step_participant_ms: data.metrics.step_participant_ms?.values,
      step_checkout_ms: data.metrics.step_checkout_ms?.values,
      step_settlement_ms: data.metrics.step_settlement_ms?.values,
      step_finalize_ms: data.metrics.step_finalize_ms?.values,
      step_payment_ms: data.metrics.step_payment_ms?.values,
      http_req_duration: data.metrics.http_req_duration?.values,
      http_req_failed: data.metrics.http_req_failed?.values,
      errors: data.metrics.errors?.values,
    }, null, 2),
  }
}
