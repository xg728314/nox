/**
 * NOX 피크 부하 테스트 — 380 동시 사용자 시나리오.
 *
 * 실 사용 가정:
 *   - 14매장 × 평균 27명 = 380 동시 접속
 *   - 카운터 5초 폴링 패턴 (실장 80명)
 *   - hostess 본인 페이지 / 채팅 폴링 (300명)
 *   - 영업 피크 시간대 (21~01시)
 *
 * 목표:
 *   - p95 < 800ms
 *   - p99 < 2000ms
 *   - error rate < 1%
 *   - Cache hit ratio 측정 (R29 캐시 효과 검증)
 *
 * 실행:
 *   $env:BASE_URL = "https://staging.example.com"
 *   $env:TOKEN_OWNER = "<owner JWT>"
 *   $env:TOKEN_HOSTESS = "<hostess JWT>"
 *   k6 run scripts/load-test/k6-peak-380.js
 */

import http from "k6/http"
import { check, sleep, group } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const TOKEN_OWNER = __ENV.TOKEN_OWNER || __ENV.TOKEN || ""
const TOKEN_HOSTESS = __ENV.TOKEN_HOSTESS || TOKEN_OWNER

if (!TOKEN_OWNER) {
  throw new Error("TOKEN_OWNER env var required.")
}

const errorRate = new Rate("errors")
const cacheHitCounter = new Counter("cache_hits")
const cacheMissCounter = new Counter("cache_misses")

const trendRooms = new Trend("rooms_ms")
const trendMonitor = new Trend("monitor_ms")
const trendBootstrap = new Trend("bootstrap_ms")
const trendChat = new Trend("chat_ms")
const trendMe = new Trend("me_ms")

// 380 동시 사용자 시나리오 — 4 단계 ramp.
export const options = {
  scenarios: {
    counter_users: {
      executor: "ramping-vus",
      exec: "counterUserFlow",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 80 },   // 실장 80명 ramp-up
        { duration: "5m",  target: 80 },   // 80명 sustained
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
    hostess_users: {
      executor: "ramping-vus",
      exec: "hostessUserFlow",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 100 },  // hostess 일부만 (300명 전부 띄우면 connection 폭발)
        { duration: "5m",  target: 300 },  // 300명 sustained — 진짜 피크
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed:   ["rate<0.01"],
    errors:            ["rate<0.01"],
    rooms_ms:          ["p(95)<500"],   // 캐시 효과 — rooms 는 매우 빨라야 함
    monitor_ms:        ["p(95)<1000"],  // monitor 는 무거움
  },
}

const ownerHeaders = { Authorization: `Bearer ${TOKEN_OWNER}`, "Content-Type": "application/json" }
const hostessHeaders = { Authorization: `Bearer ${TOKEN_HOSTESS}`, "Content-Type": "application/json" }

// Counter 사용자 플로우 — 실장 시점 (rooms + monitor 5초 폴링)
export function counterUserFlow() {
  group("counter_polling", () => {
    const r1 = http.get(`${BASE_URL}/api/rooms`, { headers: ownerHeaders, tags: { name: "rooms" } })
    trendRooms.add(r1.timings.duration)
    const ok1 = check(r1, { "rooms 200": (r) => r.status === 200 })
    errorRate.add(!ok1)
    countCacheStatus(r1)

    sleep(0.5)

    const r2 = http.get(`${BASE_URL}/api/counter/monitor`, { headers: ownerHeaders, tags: { name: "monitor" } })
    trendMonitor.add(r2.timings.duration)
    const ok2 = check(r2, { "monitor 200": (r) => r.status === 200 })
    errorRate.add(!ok2)
    countCacheStatus(r2)
  })

  // 폴링 간격 모사 — 5초 ± jitter
  sleep(4 + Math.random() * 2)
}

// Hostess 사용자 플로우 — /me 본인 페이지 + chat unread 폴링
export function hostessUserFlow() {
  group("hostess_polling", () => {
    const rMe = http.get(`${BASE_URL}/api/auth/me`, { headers: hostessHeaders, tags: { name: "me" } })
    trendMe.add(rMe.timings.duration)
    errorRate.add(!check(rMe, { "me 200": (r) => r.status === 200 }))

    const rChat = http.get(`${BASE_URL}/api/chat/unread`, { headers: hostessHeaders, tags: { name: "chat_unread" } })
    trendChat.add(rChat.timings.duration)
    errorRate.add(!check(rChat, { "chat 200": (r) => r.status === 200 }))
  })

  // hostess 폴링 — 7초 (chat unread 와 일치)
  sleep(6 + Math.random() * 2)
}

function countCacheStatus(res) {
  const cc = res.headers["Cache-Control"] || res.headers["cache-control"] || ""
  if (cc.includes("max-age")) {
    cacheHitCounter.add(1)
  } else {
    cacheMissCounter.add(1)
  }
}

export function handleSummary(data) {
  const m = data.metrics
  const summary = {
    duration_seconds: data.state?.testRunDurationMs ? Math.round(data.state.testRunDurationMs / 1000) : null,
    total_requests: m.http_reqs?.values?.count,
    requests_per_second: m.http_reqs?.values?.rate?.toFixed(2),
    error_rate_percent: ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2),
    p95_ms: m.http_req_duration?.values?.["p(95)"]?.toFixed(0),
    p99_ms: m.http_req_duration?.values?.["p(99)"]?.toFixed(0),
    rooms_p95_ms: m.rooms_ms?.values?.["p(95)"]?.toFixed(0),
    monitor_p95_ms: m.monitor_ms?.values?.["p(95)"]?.toFixed(0),
    me_p95_ms: m.me_ms?.values?.["p(95)"]?.toFixed(0),
    chat_p95_ms: m.chat_ms?.values?.["p(95)"]?.toFixed(0),
    cache_hits: m.cache_hits?.values?.count ?? 0,
    cache_misses: m.cache_misses?.values?.count ?? 0,
    pass: ((m.http_req_failed?.values?.rate ?? 0) < 0.01 &&
            (m.http_req_duration?.values?.["p(95)"] ?? Infinity) < 800),
  }
  return {
    "stdout": "\n=== NOX 380-user peak summary ===\n" + JSON.stringify(summary, null, 2) + "\n",
    "load-test-summary.json": JSON.stringify(summary, null, 2),
  }
}
