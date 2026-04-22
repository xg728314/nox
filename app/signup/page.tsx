"use client"

/**
 * Signup page — general member signup.
 *
 * Fields:
 *   - 소속 매장 (store)
 *   - 직책 (role) — 사장 / 실장 / 스테프
 *   - 이름 (full_name)
 *   - 닉네임 (nickname)
 *   - 전화번호 (phone)
 *   - 이메일 (email)
 *   - 비밀번호 (password)
 *
 * Submit shape: POSTs to /api/auth/signup with all fields including `role`.
 * Store list stays fixed (Marvel / Burning / Hwangjini / Live) because the
 * authenticated /api/stores route is not available to unauthenticated
 * signup.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

const STORE_OPTIONS = [
  { value: "마블", label: "마블 (Marvel)" },
  { value: "버닝", label: "버닝 (Burning)" },
  { value: "황진이", label: "황진이 (Hwangjini)" },
  { value: "라이브", label: "라이브 (Live)" },
] as const

type Role = "owner" | "manager" | "staff"

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "owner", label: "사장" },
  { value: "manager", label: "실장" },
  { value: "staff", label: "스테프" },
]

type FormState = {
  store: string
  role: Role | ""
  full_name: string
  nickname: string
  phone: string
  email: string
  password: string
}

const EMPTY: FormState = {
  store: "",
  role: "",
  full_name: "",
  nickname: "",
  phone: "",
  email: "",
  password: "",
}

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function validate(): string | null {
    if (!form.store) return "소속 매장을 선택하세요."
    if (!form.role) return "직책을 선택하세요."
    if (!form.full_name.trim()) return "이름을 입력하세요."
    if (!form.nickname.trim()) return "닉네임을 입력하세요."
    const phoneDigits = form.phone.replace(/\D/g, "")
    if (!phoneDigits) return "전화번호를 입력하세요."
    if (phoneDigits.length < 9 || phoneDigits.length > 15)
      return "전화번호 형식을 확인하세요."
    if (!form.email.trim()) return "이메일을 입력하세요."
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return "이메일 형식이 올바르지 않습니다."
    if (!form.password) return "비밀번호를 입력하세요."
    if (form.password.length < 6) return "비밀번호는 6자 이상이어야 합니다."
    return null
  }

  async function handleSubmit() {
    setError("")
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setLoading(true)
    try {
      const payload = {
        store: form.store,
        role: form.role,
        full_name: form.full_name.trim(),
        nickname: form.nickname.trim(),
        phone: form.phone.replace(/\D/g, ""),
        email: form.email.trim(),
        password: form.password,
      }
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.status === 404) {
        setError(
          "회원가입 API가 아직 준비 중입니다. 운영자에게 문의하세요."
        )
        return
      }

      let data: { ok?: boolean; status?: string; message?: string; error?: string } = {}
      try {
        data = await res.json()
      } catch {
        // non-JSON response
      }

      if (!res.ok) {
        setError(data.message || data.error || "가입 신청에 실패했습니다.")
        return
      }
      setSuccess(true)
    } catch {
      setError("서버 오류 또는 네트워크 문제로 신청을 보낼 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white overflow-hidden relative">
      {/* 배경 그라디언트 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.15),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.10),transparent_28%),radial-gradient(circle_at_center,rgba(99,102,241,0.08),transparent_35%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[520px]">
          <div className="mb-6">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
              <span className="text-sm font-medium tracking-wide text-cyan-100">
                NOX Counter OS
              </span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">회원가입</h1>
            <p className="mt-2 text-slate-400">
              소속 매장과 직책을 선택하고 계정 정보를 입력해 주세요.
            </p>
          </div>

          <div className="relative rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55),0_0_50px_rgba(37,99,235,0.12)] backdrop-blur-2xl sm:p-8">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

            {success ? (
              <div className="py-6 text-center">
                <div className="text-3xl">✓</div>
                <h2 className="mt-3 text-xl font-semibold">회원가입이 접수되었습니다</h2>
                <p className="mt-2 text-sm text-slate-400">
                  운영자가 확인 후 승인하면 로그인할 수 있습니다.
                </p>
                <button
                  onClick={() => router.push("/login")}
                  className="mt-6 h-12 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)]"
                >
                  로그인으로 돌아가기
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs text-cyan-200/90 tracking-widest">
                    SIGN UP
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">회원가입</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    소속 매장과 직책을 선택하고 계정 정보를 입력해 주세요.
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  {/* 소속 매장 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      소속 매장
                    </label>
                    <select
                      value={form.store}
                      onChange={(e) => update("store", e.target.value)}
                      className="w-full bg-transparent text-base outline-none [&>option]:bg-[#0A1222]"
                    >
                      <option value="">매장을 선택하세요</option>
                      {STORE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 직책 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      직책
                    </label>
                    <select
                      value={form.role}
                      onChange={(e) => update("role", e.target.value as Role | "")}
                      className="w-full bg-transparent text-base outline-none [&>option]:bg-[#0A1222]"
                    >
                      <option value="">직책을 선택하세요</option>
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 이름 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      이름
                    </label>
                    <input
                      type="text"
                      value={form.full_name}
                      onChange={(e) => update("full_name", e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="실명"
                    />
                  </div>

                  {/* 닉네임 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      닉네임
                    </label>
                    <input
                      type="text"
                      value={form.nickname}
                      onChange={(e) => update("nickname", e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="활동명"
                    />
                  </div>

                  {/* 전화번호 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      전화번호
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={form.phone}
                      onChange={(e) => update("phone", e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="01012345678"
                    />
                  </div>

                  {/* 이메일 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      이메일
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="you@nox.local"
                    />
                  </div>

                  {/* 비밀번호 */}
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">
                      비밀번호
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="6자 이상"
                    />
                  </div>
                </div>

                {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="mt-5 h-14 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? "가입 중..." : "회원가입"}
                </button>

                <p className="mt-4 text-center text-xs text-slate-500">
                  이미 계정이 있으신가요?{" "}
                  <Link href="/login" className="text-cyan-300 hover:underline">
                    로그인
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
