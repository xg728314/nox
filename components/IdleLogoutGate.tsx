"use client"

/**
 * IdleLogoutGate — app-wide idle-logout enforcer.
 *
 * Mounted once in `app/layout.tsx`. Calls `useIdleLogout` with the
 * default timeout (4 hours; see `lib/security/useIdleLogout.ts`) on
 * every protected route. Self-disables on the login / signup / reset
 * flow paths so the timer doesn't fire on already-anonymous pages.
 *
 * No UI — returns null. No props.
 *
 * Why a wrapper instead of calling useIdleLogout directly in layout.tsx?
 * `app/layout.tsx` is a server component; hooks are illegal there. This
 * client component is the smallest possible escape hatch.
 */

import { usePathname } from "next/navigation"
import { useIdleLogout } from "@/lib/security/useIdleLogout"

/**
 * Path prefixes that are anonymous-by-design — idle-logout is a no-op
 * on these because there's nothing to log out FROM.
 *
 * Keep aligned with middleware exemptions (`middleware.ts`) so we don't
 * disable the timer on a path that actually has a session.
 */
const ANONYMOUS_PREFIXES: ReadonlyArray<string> = [
  "/login",
  "/signup",
  "/find-id",
  "/reset-password",
]

function isAnonymousPath(pathname: string | null): boolean {
  if (!pathname) return false
  for (const p of ANONYMOUS_PREFIXES) {
    if (pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)) {
      return true
    }
  }
  return false
}

export default function IdleLogoutGate() {
  const pathname = usePathname()
  const disabled = isAnonymousPath(pathname)
  // Default timeout = 4h (운영 정책). useIdleLogout 의 DEFAULT_MS 가
  // 단일 진실 — 변경 시 거기서 한 번만 수정.
  useIdleLogout({ disabled })
  return null
}
