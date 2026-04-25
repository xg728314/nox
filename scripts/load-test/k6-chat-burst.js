/**
 * 채팅 폭주 시나리오 — 5K msg/일 가정 (피크 1~2 msg/초).
 *
 * 시뮬:
 *   - 100 VU 가 30 초 동안 메시지 전송 → 평균 3 msg/초/VU = 300 msg/초 (10배 가속)
 *   - 메시지 1KB 이내, 한국어 텍스트
 *   - 같은 chat_room_id 에 동시 INSERT — DB lock contention 측정
 *
 * 실행:
 *   $env:BASE_URL = "https://staging.example.com"
 *   $env:TOKEN = "<JWT>"
 *   $env:CHAT_ROOM_ID = "<chat_room_id>"
 *   k6 run scripts/load-test/k6-chat-burst.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const TOKEN = __ENV.TOKEN || ""
const CHAT_ROOM_ID = __ENV.CHAT_ROOM_ID || ""

if (!TOKEN || !CHAT_ROOM_ID) {
  throw new Error("TOKEN + CHAT_ROOM_ID env required.")
}

const errorRate = new Rate("errors")
const sendTrend = new Trend("send_ms")
const fetchTrend = new Trend("fetch_ms")

export const options = {
  scenarios: {
    burst: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "10s", target: 100 },
        { duration: "30s", target: 100 },  // 30 초 burst
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed:   ["rate<0.02"],   // 2% 까지 허용 (lock contention 가능)
    errors:            ["rate<0.02"],
  },
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }

const SAMPLE_MESSAGES = [
  "타임 시작합니다",
  "1번방 손님 입장",
  "차3 추가 부탁드립니다",
  "체크아웃 진행할게요",
  "양주 하나 더",
  "퍼블릭 하나 추가",
  "잠시만요",
  "오케이",
]

export default function () {
  // 50% 전송 / 50% 조회 — 실제 채팅창 사용 패턴
  if (Math.random() < 0.5) {
    const body = JSON.stringify({
      chat_room_id: CHAT_ROOM_ID,
      content: SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)],
    })
    const r = http.post(`${BASE_URL}/api/chat/messages`, body, { headers, tags: { name: "send" } })
    sendTrend.add(r.timings.duration)
    errorRate.add(!check(r, { "send 200/201": (r) => r.status === 200 || r.status === 201 }))
  } else {
    const r = http.get(`${BASE_URL}/api/chat/messages?chat_room_id=${CHAT_ROOM_ID}`, { headers, tags: { name: "fetch" } })
    fetchTrend.add(r.timings.duration)
    errorRate.add(!check(r, { "fetch 200": (r) => r.status === 200 }))
  }
  sleep(0.3 + Math.random() * 0.7)
}

export function handleSummary(data) {
  const m = data.metrics
  return {
    "stdout": "\n=== NOX chat burst ===\n" + JSON.stringify({
      total_requests: m.http_reqs?.values?.count,
      send_p95_ms: m.send_ms?.values?.["p(95)"]?.toFixed(0),
      fetch_p95_ms: m.fetch_ms?.values?.["p(95)"]?.toFixed(0),
      error_rate: ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2) + "%",
    }, null, 2) + "\n",
  }
}
