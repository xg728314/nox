"use client"

/**
 * useIdleLogout — 장시간 무조작 시 자동 로그아웃.
 *
 * 2026-04-24 (초기): 카운터 PC 가 밤새 로그인 상태로 방치될 때 누구나
 *   조작 가능한 상황 방지. 30분 idle → 세션 무효화 + /login 리다이렉트.
 *
 * 2026-04-28 (운영 정책 변경): 로그인 유지시간 4시간으로 통일. 카운터
 *   외 모든 보호 페이지에도 동일 정책 적용 (IdleLogoutGate 통해 전역
 *   마운트). fire() 호출 시 /api/auth/logout 을 호출해 HttpOnly 쿠키
 *   까지 서버에서 클리어하도록 변경.
 *
 * 2026-05-03 (운영 정책 변경 v2): 5시간으로 연장.
 *   사용자 호소: "사용 안 할 때 40분만에 로그아웃됐다." 원인 = Supabase
 *   JWT 기본 1h 만료 + idle 동안 자동 refresh 안 됨. 화면을 켜둔 상태
 *   (idle) 라면 사용자가 다시 만질 때까지 세션을 유지해야 한다.
 *
 *   Fix:
 *     1) DEFAULT_MS 4h → 5h (idle timeout 자체)
 *     2) 백그라운드 자동 refresh — 50분마다 silent /api/auth/refresh
 *        호출. Supabase JWT (1h 기본) 가 만료되기 전에 갱신 → idle 동안
 *        세션 끊김 없음. refresh_token cookie 가 만료되면 (5h+) 그때
 *        idle timer 가 동작.
 *     3) 쿠키 maxAge 도 4h → 5h (login/refresh route 측에서)
 *
 * idle 판정 이벤트: mousemove, keydown, click, touchstart, visibilitychange.
 *
 * 사용:
 *   // 디폴트 (5h, 글로벌 게이트가 사용)
 *   useIdleLogout()
 *   // 페이지별 커스텀
 *   useIdleLogout({ timeoutMs: 60 * 60_000, onLogout: () => ... })
 */

import { useEffect, useRef } from "react"

type Options = {
  /** idle 로 간주할 ms. 기본 5시간. */
  timeoutMs?: number
  /** 타임아웃 발생 시 호출. 미지정 시 서버 logout + /login?idle=1. */
  onLogout?: () => void
  /** disabled=true 이면 아무 작업 안 함 (로그인 페이지 등). */
  disabled?: boolean
}

/**
 * 기본 idle 임계값 — 운영 정책상 로그인 유지시간 5시간 (2026-05-03 변경).
 * 변경 시 [app/api/auth/login/route.ts], [app/api/auth/login/mfa/route.ts],
 * [app/api/auth/refresh/route.ts] 의 cookie maxAge 와 함께 갱신.
 */
const DEFAULT_MS = 5 * 60 * 60 * 1000

/**
 * 자동 refresh 주기 — Supabase JWT 기본 1h. 50분 = 83% — 만료 전에 충분히
 * 안전하게 갱신. 너무 짧으면 부하 증가, 너무 길면 잠깐의 클럭 드리프트로
 * 만료 윈도우 놓칠 수 있음.
 */
const AUTO_REFRESH_MS = 50 * 60 * 1000

async function silentRefreshAccessToken(): Promise<void> {
  try {
    await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    })
  } catch {
    // 네트워크 일시 오류는 무시. 다음 주기에 재시도.
  }
}

const EVENTS: (keyof DocumentEventMap)[] = [
  "mousemove",
  "keydown",
  "click",
  "touchstart",
  "visibilitychange",
]

async function performServerLogout(): Promise<void> {
  // 서버 쿠키 무효화. 실패해도 redirect 는 진행 (best-effort).
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      // keepalive 로 unload 시점에도 전송 보장.
      keepalive: true,
    })
  } catch {
    // 네트워크 오류는 무시 — 다음 단계 redirect 로 fallback.
  }
}

export function useIdleLogout(opts: Options = {}) {
  const { timeoutMs = DEFAULT_MS, onLogout, disabled = false } = opts
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onLogoutRef = useRef(onLogout)
  onLogoutRef.current = onLogout

  useEffect(() => {
    if (disabled) return
    if (typeof window === "undefined") return

    const fire = () => {
      const handler = onLogoutRef.current
      if (handler) {
        handler()
        return
      }
      // 기본 행동: 서버 쿠키까지 클리어 후 /login?idle=1 로 리다이렉트.
      ;(async () => {
        try {
          window.localStorage.removeItem("nox.auth.token")
          window.sessionStorage.clear()
        } catch { /* ignore */ }
        await performServerLogout()
        // location.href 로 강제 풀-네비게이션 — SPA state 잔존 방지.
        window.location.href = "/login?idle=1"
      })()
    }

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(fire, timeoutMs)
    }

    // 2026-05-03: 백그라운드 자동 refresh — Supabase JWT (1h) 가 idle 동안에도
    //   만료되지 않도록 주기적으로 silent refresh. 사용자가 5시간 idle 이어도
    //   화면이 켜져 있으면 세션 살아있음.
    refreshIntervalRef.current = setInterval(() => {
      void silentRefreshAccessToken()
    }, AUTO_REFRESH_MS)

    reset()
    for (const e of EVENTS) {
      document.addEventListener(e, reset, { passive: true })
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
      for (const e of EVENTS) {
        document.removeEventListener(e, reset)
      }
    }
  }, [timeoutMs, disabled])
}
