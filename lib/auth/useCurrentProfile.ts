"use client"

/**
 * useCurrentProfile — read-only access to the current user's auth
 * identity, sourced from the server.
 *
 * SECURITY (R-1 remediation):
 *   Previously this hook read `user_id` / `role` / `store_uuid` from
 *   `localStorage`. Those values were client-writable and therefore
 *   untrustworthy — a UI can render or hide menus based on them but
 *   the server was the real gate. Now the hook fetches the values
 *   from `/api/auth/me` (which runs `resolveAuthContext` server-side,
 *   reading the HttpOnly cookie).
 *
 *   Consequences:
 *     - `profile` is `null` until the round-trip completes.
 *     - If the cookie is missing / expired, `/api/auth/me` returns
 *       401 and this hook surfaces `needsLogin = true`. Callers
 *       should redirect to `/login` in that case.
 *     - No fallback to localStorage. Clients that formerly relied on
 *       synchronous localStorage reads must tolerate an async state.
 */

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type CurrentProfile = {
  user_id: string
  membership_id: string
  store_uuid: string
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  membership_status: "approved" | "pending" | "rejected" | "suspended"
}

type State =
  | { loading: true;  profile: null;             needsLogin: false; error: null }
  | { loading: false; profile: CurrentProfile;   needsLogin: false; error: null }
  | { loading: false; profile: null;             needsLogin: true;  error: null }
  | { loading: false; profile: null;             needsLogin: false; error: string }

const INITIAL: State = { loading: true, profile: null, needsLogin: false, error: null }

/**
 * Full-state variant. Preferred for new code.
 */
export function useCurrentProfileState(): State {
  const [state, setState] = useState<State>(INITIAL)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void (async () => {
      try {
        const r = await apiFetch("/api/auth/me")
        if (!mounted.current) return
        if (r.status === 401 || r.status === 403) {
          setState({ loading: false, profile: null, needsLogin: true, error: null })
          return
        }
        if (!r.ok) {
          setState({ loading: false, profile: null, needsLogin: false, error: `HTTP ${r.status}` })
          return
        }
        const data = (await r.json()) as CurrentProfile
        setState({ loading: false, profile: data, needsLogin: false, error: null })
      } catch (e) {
        if (!mounted.current) return
        setState({
          loading: false, profile: null, needsLogin: false,
          error: e instanceof Error ? e.message : "network error",
        })
      }
    })()
    return () => { mounted.current = false }
  }, [])
  return state
}

/**
 * Backwards-compatible signature: returns just the profile object
 * (or null while loading / unauthenticated). Existing callers keep
 * working without changes. Use `useCurrentProfileState()` when you
 * need to distinguish "loading" from "unauthenticated".
 */
export function useCurrentProfile(): CurrentProfile | null {
  const s = useCurrentProfileState()
  return s.profile
}
