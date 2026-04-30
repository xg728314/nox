"use client"

/**
 * R-Counter-Clock (2026-04-30): client clock 보정.
 *
 * 운영자 의도:
 *   "카운터 PC 시계가 매장마다 어긋난다. UI 의 경과/남은 시간이 잘못
 *    표시되는 거 막아라."
 *
 * 핵심 발견:
 *   - 정산 금액 자체는 server-side 가 participant.price_amount 직접 합산.
 *     → 시계 어긋남이 **금액에는 영향 X**.
 *   - 위험은 UI 표시:
 *     · 경과 시간 (elapsed) — 손님이 본 시간과 다름
 *     · 남은 시간 (remaining) — 연장 누락 / 조기 연장 압박
 *   - 정산 결과 발생하면 PC 시계 1초 전후 차이는 무의미하지만, 매장간
 *     5~30분 어긋남은 실제 운영 사고 원인.
 *
 * 동작:
 *   - 페이지 mount 시 1회 /api/system/time fetch.
 *   - clientNowAtFetch / serverNow 차이 = offsetMs 계산.
 *   - useServerClock() 훅이 매 tick 마다 `Date.now() + offsetMs` 반환.
 *   - fetch 실패 시 offsetMs=0 (= 기존 동작 fallback). silent.
 *
 * 사용:
 *   ```ts
 *   const now = useServerClock(1000) // ms tick
 *   <span>{fmtRemaining(roomRemainingMs(participants, now, sessionStartedAt))}</span>
 *   ```
 *
 * 정확도:
 *   - 네트워크 RTT 의 절반만큼 오차 가능 (수백 ms 수준). 운영상 무시 가능.
 *   - 더 정밀한 보정 (NTP-style RTT 측정) 은 별도 라운드.
 */

import { useEffect, useRef, useState } from "react"

let cachedOffsetMs = 0
let lastFetchAt = 0

/** server now 와 client now 의 차이 ms. fetch 전엔 0. */
export function getServerOffsetMs(): number {
  return cachedOffsetMs
}

/** server-adjusted current time. fetch 안 됐으면 client now. */
export function getServerNow(): number {
  return Date.now() + cachedOffsetMs
}

/**
 * /api/system/time 호출하여 offset 갱신.
 * - 5분 이내 재fetch 는 skip.
 * - 실패 silent (offset 미변경).
 */
export async function refreshServerOffset(force = false): Promise<number> {
  const now = Date.now()
  if (!force && now - lastFetchAt < 5 * 60 * 1000 && lastFetchAt !== 0) {
    return cachedOffsetMs
  }
  try {
    const t0 = Date.now()
    const res = await fetch("/api/system/time", { cache: "no-store" })
    if (!res.ok) return cachedOffsetMs
    const t1 = Date.now()
    const data = (await res.json()) as { server_now_ms: number }
    if (typeof data.server_now_ms !== "number") return cachedOffsetMs
    // RTT 절반만큼 보정 (server 가 read 한 시점은 t0 + RTT/2 근사).
    const halfRtt = Math.floor((t1 - t0) / 2)
    const clientApprox = t0 + halfRtt
    cachedOffsetMs = data.server_now_ms - clientApprox
    lastFetchAt = now
  } catch {
    // 네트워크 오류 silent — fallback 으로 cachedOffsetMs (0 또는 이전값) 유지.
  }
  return cachedOffsetMs
}

/**
 * mount 시 server offset 갱신 + tickMs 마다 server-adjusted now 반환.
 *
 * @param tickMs - 갱신 주기 (default 1000ms = 1초)
 */
export function useServerClock(tickMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now() + cachedOffsetMs)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    void refreshServerOffset().then(() => {
      if (mountedRef.current) setNow(Date.now() + cachedOffsetMs)
    })
    const id = setInterval(() => {
      if (mountedRef.current) setNow(Date.now() + cachedOffsetMs)
    }, tickMs)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [tickMs])

  return now
}
