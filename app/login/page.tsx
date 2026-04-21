"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { EMAIL_OTP_LENGTH, TOTP_CODE_LENGTH } from "@/lib/security/otpLength"

export default function LoginPage() {
  const router = useRouter()

  // HOTFIX: Supabase recovery emails sent before the redirectTo fix was
  // deployed point at the project Site URL (root "/"), which this app's
  // root page redirects to /login — preserving the `#access_token=…&type=
  // recovery` fragment on the browser side. If we detect such a fragment
  // here, forward the user to the actual password-change page so the
  // recovery tokens aren't dropped on the floor. The fragment is read
  // client-side; it is never transmitted to the server.
  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash || ""
    if (hash.includes("type=recovery") && hash.includes("access_token=")) {
      window.location.replace(`/reset-password/confirm${hash}`)
    }
  }, [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [remember, setRemember] = useState(true)
  const [mfaStep, setMfaStep] = useState(false)
  const [code, setCode] = useState("")
  // STEP-5: "email" = new-device email OTP flow (default bootstrap),
  //         "totp" = legacy TOTP flow for users who opted into TOTP later.
  const [verifyMode, setVerifyMode] = useState<"email" | "totp">("email")
  const [verifyMessage, setVerifyMessage] = useState("")
  // Email OTP length = Supabase email token length (EMAIL_OTP_LENGTH).
  // TOTP length = RFC 6238 fixed 6. Centralized to prevent UI/validation drift.
  const expectedCodeLength = verifyMode === "email" ? EMAIL_OTP_LENGTH : TOTP_CODE_LENGTH

  function ensureDeviceId(): string {
    try {
      let id = localStorage.getItem("device_id")
      if (!id) {
        id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
        localStorage.setItem("device_id", id)
      }
      return id
    } catch {
      return `dev-${Date.now()}`
    }
  }

  type SessionPayload = {
    access_token?: string
    user_id?: string
    membership_id?: string
    store_uuid?: string
    role?: string
  }

  function finalizeSession(data: SessionPayload): boolean {
    // SECURITY (R-1 remediation): the server has already set the
    // HttpOnly cookie `nox_access_token` on this response. The client
    // MUST NOT write the token to localStorage (XSS takeover risk) and
    // MUST NOT persist role/store_uuid client-side (UI spoofing risk).
    // Subsequent API calls travel the cookie automatically via apiFetch.
    if (!data || typeof data.access_token !== "string" || data.access_token.length === 0) {
      setError("토큰을 받지 못했습니다.")
      return false
    }

    // Defence-in-depth: purge any residual auth keys from prior (pre-fix)
    // sessions so a stale localStorage entry cannot be re-used anywhere.
    try {
      localStorage.removeItem("access_token")
      localStorage.removeItem("user_id")
      localStorage.removeItem("membership_id")
      localStorage.removeItem("store_uuid")
      localStorage.removeItem("role")
    } catch { /* storage unavailable — safe to ignore */ }

    const dest =
      data.role === "owner"   ? "/owner" :
      data.role === "manager" ? "/manager" :
      data.role === "hostess" ? "/me" :
      data.role === "counter" ? "/counter" :
      "/counter"
    router.push(dest)
    return true
  }

  async function handleLogin() {
    setLoading(true)
    setError("")
    try {
      const device_id = ensureDeviceId()
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, device_id }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === "AUTH_FAILED") {
          setError("비밀번호가 올바르지 않습니다.")
        } else if (data.error === "MEMBERSHIP_NOT_APPROVED" || data.error === "MEMBERSHIP_NOT_FOUND") {
          setError("등록된 계정이 없습니다.")
        } else {
          setError(data.message || "로그인 실패")
        }
        return
      }
      // STEP-5: new-device email OTP (primary path for all bootstrap users).
      if (data.verification_required === "email") {
        setVerifyMode("email")
        setVerifyMessage("등록된 이메일로 전송된 인증 코드를 입력하세요.")
        setMfaStep(true)
        setCode("")
        return
      }
      // Legacy: user had TOTP enrolled. Kept for future opt-in TOTP upgrade.
      if (data.mfa_required === true) {
        setVerifyMode("totp")
        setVerifyMessage(`등록된 인증기의 ${TOTP_CODE_LENGTH}자리 코드를 입력하세요.`)
        setMfaStep(true)
        setCode("")
        return
      }
      finalizeSession(data)
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  // STEP-5: Email OTP verification (new-device bootstrap path).
  async function handleEmailOtpVerify() {
    if (!new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(code)) {
      setError(`${EMAIL_OTP_LENGTH}자리 인증 코드를 입력하세요.`)
      return
    }
    setLoading(true)
    setError("")
    try {
      const device_id = ensureDeviceId()
      const res = await fetch("/api/auth/login/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          code,
          device_id,
          remember_device: remember,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === "INVALID_CODE") {
          setError("인증 코드가 일치하지 않습니다.")
        } else if (data.error === "RATE_LIMITED") {
          setError(data.message || "잠시 후 다시 시도하세요.")
        } else if (data.error === "AUTH_FAILED") {
          setError("비밀번호가 올바르지 않습니다.")
        } else if (data.error === "EXPIRED" || data.error === "CODE_EXPIRED") {
          setError("인증 시간이 만료되었습니다.")
        } else {
          setError(data.message || "인증 실패")
        }
        return
      }
      finalizeSession(data)
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  async function handleMfa() {
    if (!new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(code)) {
      setError(`${TOTP_CODE_LENGTH}자리 인증 코드를 입력하세요.`)
      return
    }
    setLoading(true)
    setError("")
    try {
      const device_id = ensureDeviceId()
      const res = await fetch("/api/auth/login/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          code,
          device_id,
          remember_device: remember,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === "INVALID_CODE") {
          setError("인증 코드가 일치하지 않습니다.")
        } else if (data.error === "RATE_LIMITED") {
          setError(data.message || "잠시 후 다시 시도하세요.")
        } else if (data.error === "EXPIRED" || data.error === "CODE_EXPIRED") {
          setError("인증 시간이 만료되었습니다.")
        } else {
          setError(data.message || "MFA 인증 실패")
        }
        return
      }
      finalizeSession(data)
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  function cancelMfa() {
    setMfaStep(false)
    setCode("")
    setError("")
    setVerifyMessage("")
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white overflow-hidden relative">
      {/* 배경 그라디언트 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.15),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.10),transparent_28%),radial-gradient(circle_at_center,rgba(99,102,241,0.08),transparent_35%)]" />
      {/* 그리드 */}
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1.1fr_0.9fr]">
        {/* 좌측 */}
        <section className="hidden lg:flex flex-col justify-between px-12 py-10 border-r border-white/10 bg-white/[0.02]">
          <div>
            <div className="inline-flex items-center gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
              <span className="text-sm font-medium tracking-wide text-cyan-100">NOX Counter OS</span>
            </div>
            <div className="mt-10 max-w-xl">
              <h1 className="text-5xl font-semibold leading-tight tracking-tight">
                카운터 운영에<br />
                <span className="text-cyan-300">집중된 시스템</span>
              </h1>
              <p className="mt-5 text-lg text-slate-300 leading-8">
                실시간 룸 현황, 정산, 스태프 관리를<br />
                하나의 화면에서 처리합니다.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "실시간 상태", value: "LIVE" },
              { label: "스토어 스코프", value: "RLS" },
              { label: "운영 모드", value: "FOCUS" },
            ].map((item) => (
              <div key={item.label} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="text-xs text-slate-400">{item.label}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 우측 로그인 폼 */}
        <section className="flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-[460px]">
            {/* 모바일 헤더 */}
            <div className="mb-6 lg:hidden">
              <div className="inline-flex items-center gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
                <span className="text-sm font-medium tracking-wide text-cyan-100">NOX Counter OS</span>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">{mfaStep ? "기기 인증" : "로그인"}</h1>
              <p className="mt-2 text-slate-400">
                {mfaStep
                  ? (verifyMode === "totp"
                    ? `등록된 인증기의 ${TOTP_CODE_LENGTH}자리 코드를 입력하세요.`
                    : "등록된 이메일로 전송된 인증 코드를 입력하세요.")
                  : "계정 정보를 입력해 주세요."}
              </p>
            </div>

            {/* 카드 */}
            <div className="relative rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55),0_0_50px_rgba(37,99,235,0.12)] backdrop-blur-2xl sm:p-8">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-cyan-200/90 tracking-widest">{mfaStep ? "DEVICE VERIFY" : "SECURE SIGN-IN"}</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">{mfaStep ? "기기 인증" : "로그인"}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {mfaStep
                      ? (verifyMode === "totp"
                        ? `등록된 인증기의 ${TOTP_CODE_LENGTH}자리 코드를 입력하세요.`
                        : "등록된 이메일로 전송된 인증 코드를 입력하세요.")
                      : "계정 정보를 입력해 주세요."}
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-300">
                  운영 준비
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                  <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                    placeholder="manager@nox.local"
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                  <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">비밀번호</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !mfaStep && handleLogin()}
                    disabled={mfaStep}
                    className="w-full bg-transparent text-base outline-none placeholder:text-slate-500 disabled:opacity-60"
                    placeholder="••••••••"
                  />
                </div>
                {mfaStep && (
                  <div className="rounded-2xl border border-cyan-300/30 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-cyan-200 mb-2">
                      인증 코드 ({expectedCodeLength}자리)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={expectedCodeLength}
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, expectedCodeLength))}
                      onKeyDown={e => e.key === "Enter" && (verifyMode === "email" ? handleEmailOtpVerify() : handleMfa())}
                      autoFocus
                      className="w-full bg-transparent text-base tracking-[0.4em] outline-none placeholder:text-slate-500"
                      placeholder="000000"
                    />
                    {verifyMessage && (
                      <p className="mt-2 text-xs text-cyan-200/80">{verifyMessage}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center text-sm">
                <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-400"
                  />
                  로그인 상태 유지
                </label>
              </div>

              {error && (
                <p className="mt-3 text-red-400 text-sm">{error}</p>
              )}

              <button
                onClick={mfaStep ? (verifyMode === "email" ? handleEmailOtpVerify : handleMfa) : handleLogin}
                disabled={loading}
                className="mt-5 h-14 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
              >
                {loading
                  ? (mfaStep ? "확인 중..." : "로그인 중...")
                  : (mfaStep ? "인증하기" : "로그인")}
              </button>

              {mfaStep && (
                <>
                  <button
                    onClick={() => { if (!loading) { handleLogin() } }}
                    disabled={loading}
                    className="mt-2 h-10 w-full rounded-2xl border border-cyan-500/20 bg-cyan-500/5 text-xs text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50"
                  >
                    코드 다시 보내기
                  </button>
                  <button
                    onClick={cancelMfa}
                    disabled={loading}
                    className="mt-2 h-10 w-full rounded-2xl border border-white/10 bg-white/[0.04] text-xs text-slate-300 hover:bg-white/[0.07] disabled:opacity-50"
                  >
                    취소
                  </button>
                </>
              )}

              <p className="mt-4 text-center text-xs text-slate-500">
                <Link href="/signup" className="text-cyan-300 hover:underline">
                  계정 만들기
                </Link>
              </p>
              <p className="mt-2 text-center text-xs text-slate-500">
                <Link href="/find-id" className="text-slate-400 hover:text-cyan-300 hover:underline">
                  아이디 찾기
                </Link>
                {" · "}
                <Link href="/reset-password" className="text-slate-400 hover:text-cyan-300 hover:underline">
                  비밀번호를 잊으셨나요?
                </Link>
              </p>

              <div className="mt-5 rounded-3xl border border-cyan-300/10 bg-cyan-400/[0.05] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">로그인 후 연결</div>
                    <div className="mt-1 text-sm font-medium text-white">store_uuid / role / status resolve</div>
                  </div>
                  <div className="h-10 w-10 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 flex items-center justify-center text-cyan-200 text-lg">
                    ✓
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full w-2/3 rounded-full bg-[linear-gradient(90deg,#14b8a6,#22c55e)] shadow-[0_0_14px_rgba(34,197,94,0.45)]" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
