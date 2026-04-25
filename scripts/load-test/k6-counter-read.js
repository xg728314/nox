/**
 * NOX 카운터 read-path 부하 테스트.
 *
 * 대상: /api/rooms, /api/counter/monitor
 * 전략: 점증 VU + 60초 지속 반복. 14 매장 동시접속 시나리오 시뮬레이션.
 *
 * 실행:
 *   $env:BASE_URL="https://<preview>.vercel.app"; $env:TOKEN="eyJ..."
 *   k6 run scripts/load-test/k6-counter-read.js
 *
 * 결과 해석:
 *   http_req_duration p(95) < 800ms, p(99) < 2s 이면 OK
 *   http_req_failed  rate  < 1%    이면 OK
 *
 * 2026-04-24 작성. 6~8층 확장 전 read 경로 한계 측정 baseline.
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const TOKEN    = __ENV.TOKEN || ""

if (!TOKEN) {
  throw new Error("TOKEN env var required. 먼저 /api/auth/login 로 발급.")
}

const errorRate = new Rate("errors")
const roomsTrend = new Trend("rooms_ms")
const monitorTrend = new Trend("monitor_ms")

export const options = {
  scenarios: {
    steady_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },  // ramp-up
        { duration: "2m",  target: 20 },  // steady 20 VU
        { duration: "30s", target: 50 },  // step-up
        { duration: "2m",  target: 50 },  // steady 50 VU (14 매장 × 3.5 단말)
        { duration: "30s", target: 0 },   // ramp-down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed:   ["rate<0.01"],
    errors:            ["rate<0.01"],
  },
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
}

export default function () {
  // 1. /api/rooms — 카운터 대시보드 메인 호출
  const r1 = http.get(`${BASE_URL}/api/rooms`, { headers, tags: { name: "rooms" } })
  roomsTrend.add(r1.timings.duration)
  const ok1 = check(r1, {
    "rooms 200": (r) => r.status === 200,
    "rooms has rooms[]": (r) => {
      try { return Array.isArray(r.json("rooms")) } catch { return false }
    },
  })
  errorRate.add(!ok1)

  sleep(1)

  // 2. /api/counter/monitor — BLE 미니맵용
  const r2 = http.get(`${BASE_URL}/api/counter/monitor`, { headers, tags: { name: "monitor" } })
  monitorTrend.add(r2.timings.duration)
  const ok2 = check(r2, {
    "monitor 200": (r) => r.status === 200,
    "monitor response 형태": (r) => {
      try {
        const body = r.json()
        return typeof body === "object" && body !== null
      } catch { return false }
    },
  })
  errorRate.add(!ok2)

  // 실제 사용자 폴링 간격 모사 — 3~5초
  sleep(3 + Math.random() * 2)
}

export function handleSummary(data) {
  const summary = {
    "checks": data.metrics.checks?.values,
    "http_req_duration": data.metrics.http_req_duration?.values,
    "http_req_failed": data.metrics.http_req_failed?.values,
    "rooms_ms": data.metrics.rooms_ms?.values,
    "monitor_ms": data.metrics.monitor_ms?.values,
    "errors": data.metrics.errors?.values,
  }
  return {
    "stdout": JSON.stringify(summary, null, 2),
  }
}
