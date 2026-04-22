"use client"

/**
 * STEP-028C — Reset password page (UI only).
 *
 * Calls the existing /api/auth/reset-password producer. Shows the
 * uniform "if registered, an email was sent" message regardless of
 * the API outcome to preserve email-existence privacy.
 */

import { useEffect, useState } from "react"
import Link from "next/link"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type DoneState =
  | { kind: "queued"; message: string }
  | { kind: "rate_limited"; message: string; retryAfter?: number }
  | { kind: "unknown"; message: string }

type RecoveryFragment =
  | null
  | { kind: "success"; hash: string }
  | { kind: "expired"; description: string | null }
  | { kind: "error"; code: string | null; description: string | null }

/**
 * Parse `#access_token=...&type=recovery` or `#error=access_denied&
 * error_code=otp_expired&...` fragments that Supabase appends to the
 * redirectTo URL.
 */
function parseRecoveryFragment(hash: string): RecoveryFragment {
  if (!hash || hash.length < 2) return null
  const h = hash.startsWith("#") ? hash.slice(1) : hash
  const p = new URLSearchParams(h)
  if (p.get("access_token") && p.get("type") === "recovery") {
    return { kind: "success", hash: `#${h}` }
  }
  if (p.get("error") || p.get("error_code")) {
    const code = p.get("error_code")
    const description = p.get("error_description")
    if (code === "otp_expired") return { kind: "expired", description }
    return { kind: "error", code, description }
  }
  return null
}

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<DoneState | null>(null)
  const [recoveryError, setRecoveryError] = useState<RecoveryFragment>(null)

  // Recovery tokens / error fragments arrive via `window.location.hash`
  // when the user clicks the email link. We forward valid tokens to
  // /reset-password/confirm so the existing HOTFIX-2 completion page
  // handles them, and we render an inline banner for `otp_expired` /
  // generic errors so users aren't silently dumped into the login flow.
  useEffect(() => {
    if (typeof window === "undefined") return
    const frag = parseRecoveryFragment(window.location.hash)
    if (!frag) return
    if (frag.kind === "success") {
      window.location.replace(`/reset-password/confirm${frag.hash}`)
      return
    }
    // Clear the fragment from the visible URL so a second render or
    // refresh doesn't keep flashing the error state.
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    } catch { /* noop */ }
    setRecoveryError(frag)
  }, [])

  async function handleSubmit() {
    setError("")
    if (!EMAIL_RE.test(email.trim())) {
      setError("이메일 형식이 올바르지 않습니다.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      // Our route's own per-IP rate limit (429 BEFORE calling Supabase).
      if (res.status === 429) {
        setError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.")
        return
      }
      // HOTFIX: any non-2xx response is a failure. Previously the UI
      // always parsed the body and fell through to the "unknown" success
      // card, even on 5xx (e.g. 503 SECURITY_STATE_UNAVAILABLE). A failed
      // API must NEVER display the "요청 접수됨" success state.
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string; message?: string
        }
        const tag = errBody.error ? ` (${errBody.error})` : ""
        setError(
          errBody.message ??
            `요청 처리에 실패했습니다${tag}. 잠시 후 다시 시도하세요.`,
        )
        return
      }
      // HOTFIX-3: parse the delivery classification the API emits so we
      // can show accurate wording for queued / rate_limited / unknown.
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        delivery?: "queued" | "rate_limited" | "unknown"
        message?: string
        retry_after_seconds?: number
      }
      if (body.ok !== true) {
        // 2xx but `ok` missing/false → also treat as failure.
        setError("요청 처리에 실패했습니다. 잠시 후 다시 시도하세요.")
        return
      }
      const msg = body.message ?? ""
      if (body.delivery === "queued") {
        setDone({ kind: "queued", message: msg || "비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해주세요." })
      } else if (body.delivery === "rate_limited") {
        setDone({
          kind: "rate_limited",
          message: msg || "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
          retryAfter: body.retry_after_seconds,
        })
      } else {
        setDone({
          kind: "unknown",
          message: msg || "요청이 접수되었습니다. 메일이 도착하지 않으면 잠시 후 다시 시도하거나 관리자에게 문의하세요.",
        })
      }
    } catch {
      // Network error — NEVER show the success card; keep the user on
      // the form with an explicit failure banner so they can retry.
      setError("요청 처리 중 네트워크 오류가 발생했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setLoading(false)
    }
  }

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
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">비밀번호 재설정</h1>
            <p className="mt-2 text-slate-400">
              가입 시 사용한 이메일을 입력하면 재설정 링크를 보내드립니다.
            </p>
          </div>

          <div className="relative rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55),0_0_50px_rgba(37,99,235,0.12)] backdrop-blur-2xl sm:p-8">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

            {done ? (
              <div className="py-6 text-center">
                {done.kind === "queued" && (
                  <>
                    <div className="text-3xl text-emerald-400">✓</div>
                    <h2 className="mt-3 text-xl font-semibold">이메일로 재설정 링크를 보냈습니다.</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {done.message}
                      <br />
                      <span className="text-xs text-slate-500">스팸함도 함께 확인해주세요.</span>
                    </p>
                  </>
                )}
                {done.kind === "rate_limited" && (
                  <>
                    <div className="text-3xl text-amber-400">⏳</div>
                    <h2 className="mt-3 text-xl font-semibold">잠시 후 다시 시도해주세요.</h2>
                    <p className="mt-2 text-sm text-slate-400">{done.message}</p>
                    <button
                      onClick={() => setDone(null)}
                      className="mt-4 text-xs text-cyan-300 hover:underline"
                    >
                      다시 시도
                    </button>
                  </>
                )}
                {done.kind === "unknown" && (
                  <>
                    <div className="text-3xl">✉</div>
                    <h2 className="mt-3 text-xl font-semibold">요청이 접수되었습니다.</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {done.message}
                      <br />
                      <span className="text-xs text-slate-500">발송이 확인되지 않을 경우 계정 상태 혹은 이메일 주소를 다시 확인해주세요.</span>
                    </p>
                    <button
                      onClick={() => setDone(null)}
                      className="mt-4 text-xs text-cyan-300 hover:underline"
                    >
                      다시 시도
                    </button>
                  </>
                )}
                <Link
                  href="/login"
                  className="mt-6 inline-block w-full h-12 leading-[3rem] rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)]"
                >
                  로그인으로 돌아가기
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs text-cyan-200/90 tracking-widest">PASSWORD RESET</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">비밀번호 재설정</h2>
                  <p className="mt-1 text-sm text-slate-400">가입 시 사용한 이메일을 입력하면 재설정 링크를 보내드립니다.</p>
                </div>

                {recoveryError && (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                  >
                    <div className="font-semibold">
                      {recoveryError.kind === "expired"
                        ? "재설정 링크가 만료되었거나 이미 사용되었습니다."
                        : "재설정 링크를 처리하지 못했습니다."}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
                      {recoveryError.kind === "expired"
                        ? "메일함 보안 스캐너가 링크를 먼저 열어 토큰이 소모되었을 수 있습니다. 아래에서 이메일을 다시 입력하고 새 링크를 요청해주세요."
                        : recoveryError.kind === "error"
                          ? (recoveryError.description ?? "잠시 후 새 링크를 요청해주세요.")
                          : "잠시 후 새 링크를 요청해주세요."}
                    </p>
                  </div>
                )}

                <div className="mt-6 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">이메일</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="you@nox.local"
                    />
                  </div>
                </div>

                {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="mt-5 h-14 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)] disabled:opacity-50"
                >
                  {loading ? "전송 중..." : "재설정 링크 보내기"}
                </button>

                <p className="mt-4 text-center text-xs text-slate-500">
                  <Link href="/find-id" className="text-slate-400 hover:text-cyan-300 hover:underline">아이디 찾기</Link>
                  {" · "}
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
