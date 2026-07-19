"use client"
import type { ReactNode } from "react"
import { PhoneFrame } from "../_components/PhoneFrame"
import { ToastProvider } from "../_components/Toast"
import { useMe } from "../_hooks/useMobileData"
import { SuperAdminStoreBar } from "../_components/SuperAdminStoreBar"

/**
 * 스태프동기화 앱 sublayout — /m/(app)/* 만 적용.
 *
 * - PhoneFrame: 데스크탑 시뮬레이션
 * - ToastProvider: 전역 토스트
 * - 인증 가드: /api/auth/me 실패 시 /login 으로 (SessionExpiredGate 는
 *   apiFetch 에서 401 캐치 후 글로벌 이벤트로 처리됨)
 */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <PhoneFrame>
        {/* R-super-store-bar (2026-07-19): super_admin 전용 매장 전환 bar.
            PhoneFrame 안 최상단. 일반 사용자는 렌더 X. */}
        <SuperAdminStoreBar />
        <AuthGate>{children}</AuthGate>
      </PhoneFrame>
    </ToastProvider>
  )
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, error } = useMe()
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#7A746A] text-[13px] font-bold">
        로딩 중...
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-[14px] font-extrabold text-[#2D2B26]">로그인이 필요합니다</div>
        <a
          href="/login?next=/m"
          className="rounded-full bg-[#2D2B26] text-white text-[13px] font-bold px-5 py-2.5 no-underline"
        >
          로그인 화면으로
        </a>
      </div>
    )
  }
  return <>{children}</>
}
