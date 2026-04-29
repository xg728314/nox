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
 *   까지 서버에서 클리어하도록 변경 — 이전에는 클라 storage 만 정리해
 *   쿠키가 자연 만료까지 살아있는 잔존 위험이 있었음.
 *
 * idle 판정 이벤트: mousemove, keydown, click, touchstart, visibilitychange.
 *
 * 사용:
 *   // 디폴트 (4h, 글로벌 게이트가 사용)
 *   useIdleLogout()
 *   // 페이지별 커스텀
 *   useIdleLogout({ timeoutMs: 60 * 60_000, onLogout: () => ... })
 */

import { useEffect, useRef } from "react"

type Options = {
  /** idle 로 간주할 ms. 기본 4시간. */
  timeoutMs?: number
  /** 타임아웃 발생 시 호출. 미지정 시 서버 logout + /login?idle=1. */
  onLogout?: () => void
  /** disabled=true 이면 아무 작업 안 함 (로그인 페이지 등). */
  disabled?: boolean
}

/**
 * 기본 idle 임계값 — 운영 정책상 로그인 유지시간 4시간.
 * 변경 시 [app/api/auth/login/route.ts] 의 cookie maxAge 와 함께
 * 갱신 (cookie 는 access_token JWT 의 expires_in 을 따르므로 Supabase
 * 프로젝트 JWT 만료도 같이 검토 필요).
 */
const DEFAULT_MS = 4 * 60 * 60 * 1000

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
