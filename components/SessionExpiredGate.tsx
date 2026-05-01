"use client"

/**
 * SessionExpiredGate — 전역 인증 만료 처리.
 *
 * R-Session-Expired-Gate (2026-05-01):
 *   운영자 정책 (사용자):
 *     "로그아웃 시간 됐으면 다른 기능 못 하게.
 *      '로그아웃 되었습니다 (시간 초과)' 경고장 띄우고
 *      확인 누르면 로그인 창으로."
 *
 * 동작:
 *   - apiFetch 가 401 받으면 "nox:auth:expired" 이벤트 dispatch.
 *   - 본 컴포넌트가 listen → 전역 modal 표시 (z-index 최상위).
 *   - modal 동안 다른 작업 차단 (backdrop 가 클릭 흡수, ESC 도 무시).
 *   - "로그인 화면으로" 버튼 → /login?expired=1.
 *   - dedupe: 한 번만 표시. 같은 401 여러 번 와도 modal 1개.
 *
 * 위치: app/layout.tsx 의 body 첫 자식. 모든 페이지에서 자동 동작.
 *
 * 제외:
 *   - /login, /signup, /reset-password, /find-id 페이지에서는 mount 안 함
 *     (이 페이지들은 401 정상 흐름. 무한 modal 방지).
 */

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/reset-password",
  "/find-id",
]

export default function SessionExpiredGate() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // 인증 전 화면에서는 비활성 (login 자체가 401 케이스).
  const isAuthScreen =
    !!pathname &&
    HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isAuthScreen) return

    const handler = () => {
      setOpen(true)
    }
    window.addEventListener("nox:auth:expired", handler)
    return () => {
      window.removeEventListener("nox:auth:expired", handler)
    }
  }, [isAuthScreen])

  // 인증 화면에서는 만약 modal 떠있으면 자동 close (정상 로그인 진행).
  useEffect(() => {
    if (isAuthScreen && open) setOpen(false)
  }, [isAuthScreen, open])

  if (!open || isAuthScreen) return null

  function goLogin() {
    setOpen(false)
    // location.href 로 강제 풀-네비게이션 — SPA state 잔존 방지.
    if (typeof window !== "undefined") {
      window.location.href = "/login?expired=1"
    } else {
      router.push("/login?expired=1")
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      // backdrop 클릭 무시 — 사용자가 "로그인 화면으로" 명시적 클릭 필수.
      onClick={(e) => e.stopPropagation()}
      // ESC 등 키 무시.
      onKeyDown={(e) => e.preventDefault()}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="max-w-sm w-full rounded-2xl border border-amber-500/40 bg-[#0a0c14] p-6 shadow-2xl">
        <div className="text-center">
          <div className="text-3xl mb-3">🔒</div>
          <div
            id="session-expired-title"
            className="text-lg font-bold text-amber-200 mb-2"
          >
            로그아웃 되었습니다
          </div>
          <div className="text-xs text-amber-300/70 mb-5">시간 초과</div>
        </div>
        <div className="text-sm text-slate-300 leading-relaxed text-center mb-6">
          일정 시간 사용하지 않아 자동 로그아웃 되었습니다.
          <br />
          다시 로그인 후 진행해주세요.
        </div>
        <button
          onClick={goLogin}
          autoFocus
          className="w-full h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-100 text-sm font-semibold hover:bg-amber-500/30 transition-colors"
        >
          로그인 화면으로
        </button>
      </div>
    </div>
  )
}
