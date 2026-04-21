"use client"

/**
 * ApprovedGate — client-side role gate.
 *
 * SECURITY (R-1 remediation):
 *   Previously this component read `role` + `access_token` from
 *   `localStorage` and redirected client-side. localStorage values
 *   are attacker-writable (XSS or direct DevTools edit) so the gate
 *   was UI-only; the actual security boundary is middleware.ts + the
 *   server-side `resolveAuthContext` call inside each API route.
 *
 *   This rewrite uses `useCurrentProfileState()` which fetches from
 *   `/api/auth/me` (HttpOnly cookie backed). The gate:
 *     - shows nothing while loading
 *     - redirects to /login when the server says unauthenticated
 *     - redirects to /counter when the role is not allowed
 *     - renders children only after a server-verified allowed role
 *
 *   This is still defence-in-depth behind middleware.ts. Server APIs
 *   remain the authoritative gate.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCurrentProfileState } from "@/lib/auth/useCurrentProfile"

export default function ApprovedGate({
  allowedRoles, children,
}: { allowedRoles: string[]; children: React.ReactNode }) {
  const router = useRouter()
  const state = useCurrentProfileState()

  useEffect(() => {
    if (state.loading) return
    if (state.needsLogin) { router.push("/login"); return }
    if (!state.profile) { router.push("/login"); return }
    if (!allowedRoles.includes(state.profile.role)) { router.push("/counter"); return }
  }, [state, allowedRoles, router])

  if (state.loading) return null
  if (!state.profile) return null
  if (!allowedRoles.includes(state.profile.role)) return null
  return <>{children}</>
}
