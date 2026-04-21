"use client"

/**
 * HOTFIX-2 — Password reset COMPLETION page, explicit-token version.
 *
 * Previous implementation (HOTFIX-1) relied on Supabase client's
 * `detectSessionInUrl: true` + `onAuthStateChange(PASSWORD_RECOVERY)`
 * with a 3.5s timeout fallback. Two problems surfaced in runtime:
 *
 *   1. `flowType: "pkce"` caused the client to look for `?code=…` in
 *      the query string, NOT the `#access_token=…` hash that Supabase
 *      recovery emails actually deliver. The hash tokens were silently
 *      ignored and `PASSWORD_RECOVERY` never fired.
 *
 *   2. Even without the PKCE mismatch, race conditions between the
 *      client's automatic fragment consumption and our listener
 *      attachment could drop the event entirely, sending valid tokens
 *      to the "invalid link" branch via the timeout.
 *
 * This version:
 *   - turns OFF `detectSessionInUrl` so we own token consumption
 *   - parses the URL hash (classic Supabase recovery) AND query
 *     (`?code=…` for PKCE projects) EXPLICITLY
 *   - calls `setSession({ access_token, refresh_token })` directly for
 *     hash tokens, or `exchangeCodeForSession(code)` for PKCE code
 *   - on success, clears the URL (tokens out of history) and transitions
 *     to `ready`
 *   - only transitions to `invalid` on a REAL failure:
 *     (a) no recovery token anywhere + no existing session, OR
 *     (b) Supabase returns an explicit error (bad/expired token)
 *   - emits `console.debug` markers at each decision point so runtime
 *     verification can see exactly why any failure occurred
 */

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

type Phase = "loading" | "ready" | "invalid" | "success"
type InvalidReason =
  | "config"
  | "url_error"
  | "set_session_failed"
  | "exchange_failed"
  | "no_token"
  | ""

const LOG = "[reset-confirm]"

export default function ResetPasswordConfirmPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [invalidReason, setInvalidReason] = useState<InvalidReason>("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const supabase: SupabaseClient | null = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      console.error(LOG, "missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
      return null
    }
    // detectSessionInUrl: false — we consume tokens manually below.
    // persistSession: true — recovery session survives until updateUser completes.
    // Default flowType retained; we call setSession/exchangeCodeForSession directly.
    return createClient(url, anonKey, {
      auth: {
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: false,
      },
    })
  }, [])

  useEffect(() => {
    if (!supabase) {
      setInvalidReason("config")
      setPhase("invalid")
      return
    }
    if (typeof window === "undefined") return

    let cancelled = false

    async function init() {
      const href = window.location.href
      const hash = window.location.hash || ""
      const search = window.location.search || ""

      // Parse both hash and query. Hash is the classic recovery format.
      // Query is used when a Supabase project is configured for PKCE.
      const hashStr = hash.startsWith("#") ? hash.slice(1) : hash
      const hashParams = new URLSearchParams(hashStr)
      const queryParams = new URLSearchParams(search)

      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")
      const tokenType = hashParams.get("type") || queryParams.get("type")
      const code = queryParams.get("code")

      const errorDesc =
        hashParams.get("error_description") ||
        queryParams.get("error_description") ||
        hashParams.get("error") ||
        queryParams.get("error")

      console.debug(LOG, "URL inspect", {
        href,
        hasHashToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasPkceCode: !!code,
        tokenType,
        errorDesc,
      })

      // Case 1 — Supabase embedded an error in the callback URL. This is the
      // only case where we can conclusively say the link is invalid BEFORE
      // attempting any exchange.
      if (errorDesc) {
        console.warn(LOG, "URL contains error_description; treating as invalid", errorDesc)
        if (!cancelled) {
          setInvalidReason("url_error")
          setPhase("invalid")
        }
        return
      }

      // Case 2 — classic hash-based recovery (access_token + refresh_token).
      if (accessToken && refreshToken) {
        if (!supabase) return
        const { data, error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        console.debug(LOG, "setSession result", {
          ok: !setErr && !!data?.session,
          errorMessage: setErr?.message,
        })
        if (cancelled) return
        if (setErr || !data.session) {
          setInvalidReason("set_session_failed")
          setPhase("invalid")
          return
        }
        // Strip tokens from URL + history without triggering navigation.
        try {
          window.history.replaceState(null, "", window.location.pathname + window.location.search)
        } catch {
          /* ignore */
        }
        setPhase("ready")
        return
      }

      // Case 3 — PKCE code flow (?code=<uuid>).
      if (code) {
        if (!supabase) return
        const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        console.debug(LOG, "exchangeCodeForSession result", {
          ok: !exErr && !!data?.session,
          errorMessage: exErr?.message,
        })
        if (cancelled) return
        if (exErr || !data.session) {
          setInvalidReason("exchange_failed")
          setPhase("invalid")
          return
        }
        try {
          window.history.replaceState(null, "", window.location.pathname)
        } catch {
          /* ignore */
        }
        setPhase("ready")
        return
      }

      // Case 4 — no token in URL but a session already exists (e.g. page
      // reload after the URL was stripped). Let the user proceed with
      // password change on the existing session.
      if (!supabase) return
      const { data: sessData } = await supabase.auth.getSession()
      console.debug(LOG, "getSession fallback", { hasSession: !!sessData.session })
      if (cancelled) return
      if (sessData.session) {
        setPhase("ready")
        return
      }

      // Case 5 — genuinely no recovery material available.
      console.warn(LOG, "no recovery token or session present")
      setInvalidReason("no_token")
      setPhase("invalid")
    }

    init().catch((e) => {
      if (cancelled) return
      console.error(LOG, "init threw", e)
      setInvalidReason("set_session_failed")
      setPhase("invalid")
    })

    return () => {
      cancelled = true
    }
  }, [supabase])

  async function handleSubmit() {
    if (!supabase) {
      setError("서버 설정 오류입니다. 관리자에게 문의해주세요.")
      return
    }
    setError("")
    if (password.length < 8) {
      setError("비밀번호는 최소 8자 이상이어야 합니다.")
      return
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.")
      return
    }
    setLoading(true)
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password })
      console.debug(LOG, "updateUser result", {
        ok: !updateErr,
        errorMessage: updateErr?.message,
      })
      if (updateErr) {
        const msg = (updateErr.message || "").toLowerCase()
        if (msg.includes("session") || msg.includes("jwt") || msg.includes("auth")) {
          setError("재설정 링크가 만료되었거나 유효하지 않습니다. 비밀번호 재설정을 다시 요청해주세요.")
        } else if (msg.includes("weak") || msg.includes("short") || msg.includes("password")) {
          setError("비밀번호가 너무 약합니다. 더 강한 비밀번호를 입력해주세요.")
        } else {
          setError("비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.")
        }
        return
      }
      // Discard the recovery session so the user must log in fresh.
      try { await supabase.auth.signOut() } catch { /* ignore */ }
      setPhase("success")
      setTimeout(() => router.push("/login"), 1800)
    } catch (e) {
      console.error(LOG, "submit threw", e)
      setError("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.")
    } finally {
      setLoading(false)
    }
  }

  const invalidMessage = (() => {
    switch (invalidReason) {
      case "config":
        return "서버 설정 오류로 재설정 페이지를 불러올 수 없습니다. 관리자에게 문의해주세요."
      case "url_error":
        return "재설정 링크 처리 중 오류가 발생했습니다. 다시 비밀번호 재설정을 요청해주세요."
      case "set_session_failed":
      case "exchange_failed":
        return "재설정 링크가 만료되었거나 유효하지 않습니다. 다시 비밀번호 재설정을 요청해주세요."
      case "no_token":
      default:
        return "재설정 링크가 만료되었거나 유효하지 않습니다.\n다시 비밀번호 재설정을 요청해주세요."
    }
  })()

  return (
    <div className="min-h-screen bg-[#030814] text-white overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.15),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.10),transparent_28%),radial-gradient(circle_at_center,rgba(99,102,241,0.08),transparent_35%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[520px]">
          <div className="mb-6">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
              <span className="text-sm font-medium tracking-wide text-cyan-100">NOX Counter OS</span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">새 비밀번호 설정</h1>
            <p className="mt-2 text-slate-400">
              새로운 비밀번호를 입력하세요.
            </p>
          </div>

          <div className="relative rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55),0_0_50px_rgba(37,99,235,0.12)] backdrop-blur-2xl sm:p-8">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

            {phase === "loading" && (
              <div className="py-10 text-center">
                <div className="animate-pulse text-slate-400">재설정 링크 확인 중...</div>
              </div>
            )}

            {phase === "invalid" && (
              <div className="py-6 text-center">
                <div className="text-3xl">⚠</div>
                <h2 className="mt-3 text-xl font-semibold">링크가 유효하지 않습니다.</h2>
                <p className="mt-2 text-sm text-slate-400 whitespace-pre-line">
                  {invalidMessage}
                </p>
                <Link
                  href="/reset-password"
                  className="mt-6 inline-block w-full h-12 leading-[3rem] rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)]"
                >
                  재설정 다시 요청
                </Link>
              </div>
            )}

            {phase === "success" && (
              <div className="py-6 text-center">
                <div className="text-3xl text-emerald-400">✓</div>
                <h2 className="mt-3 text-xl font-semibold">비밀번호가 변경되었습니다</h2>
                <p className="mt-2 text-sm text-slate-400">
                  잠시 후 로그인 화면으로 이동합니다.<br />
                  새 비밀번호로 로그인해주세요.
                </p>
              </div>
            )}

            {phase === "ready" && (
              <>
                <div>
                  <div className="text-xs text-cyan-200/90 tracking-widest">NEW PASSWORD</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">새 비밀번호 설정</h2>
                  <p className="mt-1 text-sm text-slate-400">새로운 비밀번호를 입력하세요. 최소 8자 이상.</p>
                </div>

                <div className="mt-6 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">새 비밀번호</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="••••••••"
                      autoFocus
                    />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">비밀번호 확인</label>
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="mt-5 h-14 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)] disabled:opacity-50"
                >
                  {loading ? "변경 중..." : "비밀번호 변경"}
                </button>

                <p className="mt-4 text-center text-xs text-slate-500">
                  <Link href="/login" className="text-cyan-300 hover:underline">로그인으로 돌아가기</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
