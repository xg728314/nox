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
  // R39 (2026-09-09): PermGate 확장 · Agent audit 누락 항목 채움.
  //   /m 홈은 특별 처리 (아래 else 분기) · /m/chat 은 CHAT_VIEW 게이트
  { prefix: "/m/settle", perm: PERMS.SETTLE_VIEW },
  { prefix: "/m/staff", perm: PERMS.STAFF_VIEW },
  { prefix: "/m/attendance", perm: PERMS.STAFF_VIEW },
  { prefix: "/m/credits", perm: PERMS.CREDITS_VIEW },
  { prefix: "/m/inventory", perm: PERMS.INVENTORY_VIEW },
  { prefix: "/m/reports", perm: PERMS.REPORTS_VIEW },
  { prefix: "/m/store/settings", perm: PERMS.STORE_SETTINGS },
  { prefix: "/m/store/managers", perm: PERMS.MANAGERS_MANAGE },
  { prefix: "/m/store/duplicates", perm: PERMS.STAFF_VIEW },
  { prefix: "/m/hostess-manage", perm: PERMS.STAFF_MANAGE },
  { prefix: "/m/assign", perm: PERMS.ROSTER_MANAGE },
  { prefix: "/m/ops", perm: PERMS.ROSTER_MANAGE },
  // R39: 대기·서비스 페이지들 · 이전엔 게이트 밖 → chat-only 실장이 접근 가능했음
  { prefix: "/m/waiting", perm: PERMS.ROSTER_VIEW },
  { prefix: "/m/waitlist", perm: PERMS.ROSTER_VIEW },
  { prefix: "/m/service", perm: PERMS.ROSTER_VIEW },
  // LUNA 관련 (외부 커뮤니티) · chat.view 만 있어도 통과 (독립 커뮤니티)
  { prefix: "/m/lounge", perm: PERMS.CHAT_VIEW },
  { prefix: "/m/talk", perm: PERMS.CHAT_VIEW },
  { prefix: "/m/place", perm: PERMS.CHAT_VIEW },
  { prefix: "/m/live", perm: PERMS.CHAT_VIEW },
  { prefix: "/m/jobs", perm: PERMS.CHAT_VIEW },
  { prefix: "/m/chat", perm: PERMS.CHAT_VIEW },
  // 항상 접근: /m/me (전체메뉴 · 로그아웃 필수) · /m/store (매장 상세만)
]

function PermGate({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const pathname = usePathname()
  const router = useRouter()

  // R39-fix (Agent #6): render 전 preemptive block · 데이터 flash 방지
  //   1프레임 데이터 노출 이슈 해소.
  const permissions = me?.permissions
  let blocked = false
  if (permissions && pathname) {
    // 홈 /m 은 roster.view 필요 (Agent #8) · chat-only 실장은 못 들어감
    if (pathname === "/m" && permissions[PERMS.ROSTER_VIEW] !== true) blocked = true
    else {
      const gated = PATH_PERMS.find(p => pathname.startsWith(p.prefix))
      if (gated && permissions[gated.perm] !== true) blocked = true
    }
  }

  useEffect(() => {
    if (!blocked || !me?.permissions) return
    const fallback =
      me.permissions[PERMS.CHAT_VIEW] ? "/m/chat" :
      me.permissions[PERMS.ROSTER_VIEW] ? "/m" :
      "/m/me"
    router.replace(fallback)
  }, [blocked, me, router])

  if (blocked) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#7A746A] text-[13px] font-bold">
        권한 없음 · 이동 중...
      </div>
    )
  }
  return <>{children}</>
}
