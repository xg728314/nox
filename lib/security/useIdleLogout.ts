"use client"

/**
 * useIdleLogout — 장시간 무조작 시 자동 로그아웃.
 *
 * 2026-04-24: 카운터 PC 가 밤새 로그인 상태로 방치될 때 누구나 조작 가능한
 *   상황 방지. 기본 30분 idle → 세션 무효화 + /login 리다이렉트.
 *
 * idle 판정 이벤트: mousemove, keydown, click, touchstart, visibilitychange.
 *
 * 장부 페이지에서만 선택적으로 사용 (login 페이지 자체에서는 호출 안 함).
 *
 * 사용:
 *   useIdleLogout({ timeoutMs: 30 * 60_000, onLogout: () => router.push("/login") })
 */

import { useEffect, useRef } from "react"

type Options = {
  /** idle 로 간주할 ms. 기본 30분. */
  timeoutMs?: number
  /** 타임아웃 발생 시 호출. 기본은 window.location = "/login?idle=1". */
  onLogout?: () => void
  /** disabled=true 이면 아무 작업 안 함 (로그인 페이지 등). */
  disabled?: boolean
}

const DEFAULT_MS = 30 * 60 * 1000
const EVENTS: (keyof DocumentEventMap)[] = [
  "mousemove",
  "keydown",
  "click",
  "touchstart",
  "visibilitychange",
]

export function useIdleLogout(opts: Options = {}) {
  const { timeoutMs = DEFAULT_MS, onLogout, disabled = false } = opts
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLogoutRef = useRef(onLogout)
  onLogoutRef.current = onLogout

  useEffect(() => {
    if (disabled) return
    if (typeof window === "undefined") return

    const fire = () => {
      const handler = onLogoutRef.current
      if (handler) {
        handler()
      } else {
        // 기본 행동: /login?idle=1 로 리다이렉트. 토큰 삭제는 서버에 맡김
        // (HttpOnly cookie 가정) + 클라 storage 는 보수적으로 정리.
        try {
          window.localStorage.removeItem("nox.auth.token")
          window.sessionStorage.clear()
        } catch { /* ignore */ }
        window.location.href = "/login?idle=1"
      }
    }

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(fire, timeoutMs)
    }

    reset()
    for (const e of EVENTS) {
      document.addEventListener(e, reset, { passive: true })
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const e of EVENTS) {
        document.removeEventListener(e, reset)
      }
    }
  }, [timeoutMs, disabled])
}
