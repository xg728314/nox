"use client"
import type { ReactNode } from "react"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { PhoneFrame } from "../_components/PhoneFrame"
import { ToastProvider } from "../_components/Toast"
import { useMe } from "../_hooks/useMobileData"
import { SuperAdminStoreBar } from "../_components/SuperAdminStoreBar"
import { PERMS } from "@/lib/auth/permissions"

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
  return <PermGate>{children}</PermGate>
}

/**
 * R33 (2026-09-04): permission-based client guard.
 *
 * 경로 접두어 → 필요한 permission 매핑. 실장에게 「채팅만」 위임하면
 * `/m/settle`, `/m/hostess-manage`, `/m/store/settings` 등 URL 직입력해도
 * 자동으로 첫 가용 페이지로 redirect.
 *
 * defense-in-depth: 서버 API 도 requirePerm 게이트 필수 (curl 우회 방지).
 * 이 client guard 는 UX 계약 (숨긴 페이지는 안 뜨게).
 */
const PATH_PERMS: Array<{ prefix: string; perm: string }> = [
  { prefix: "/m/settle", perm: PERMS.SETTLE_VIEW },
  { prefix: "/m/staff", perm: PERMS.STAFF_VIEW },
  { prefix: "/m/attendance", perm: PERMS.STAFF_VIEW },
  { prefix: "/m/credits", perm: PERMS.CREDITS_VIEW },
  { prefix: "/m/inventory", perm: PERMS.INVENTORY_VIEW },
  { prefix: "/m/reports", perm: PERMS.REPORTS_VIEW },
  { prefix: "/m/store/settings", perm: PERMS.STORE_SETTINGS },
  { prefix: "/m/store/managers", perm: PERMS.MANAGERS_MANAGE },
  { prefix: "/m/hostess-manage", perm: PERMS.STAFF_MANAGE },
  { prefix: "/m/assign", perm: PERMS.ROSTER_MANAGE },
  { prefix: "/m/ops", perm: PERMS.ROSTER_MANAGE },
  // 아래는 permission 없이 항상 접근: /m, /m/chat, /m/me, /m/store (매장 상세)
]

function PermGate({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!me?.permissions || !pathname) return
    // owner + super_admin 은 전권 (effectivePermissions 로 이미 모든 키 true)
    // 매칭되는 접두어 있으면 permission 체크
    const gated = PATH_PERMS.find(p => pathname.startsWith(p.prefix))
    if (!gated) return
    if (me.permissions[gated.perm] !== true) {
      // 첫 가용 페이지로 redirect (chat.view 우선, 그다음 roster.view)
      const fallback =
        me.permissions[PERMS.CHAT_VIEW] ? "/m/chat" :
        me.permissions[PERMS.ROSTER_VIEW] ? "/m" :
        "/m/me"
      router.replace(fallback)
    }
  }, [me, pathname, router])

  return <>{children}</>
}
