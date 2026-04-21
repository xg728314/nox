"use client"

/**
 * STEP-028C — Find ID page (UI only).
 *
 * Calls the existing /api/auth/find-id producer. Three locked inputs:
 * store / full_name / phone. Renders the masked email returned by the
 * API on success, or a uniform "not found" message otherwise.
 *
 * The store list mirrors app/signup/page.tsx exactly because there is
 * no unauthenticated stores endpoint — the four floor-5 stores are
 * fixed by the same task lock.
 */

import { useState } from "react"
import Link from "next/link"

const STORE_OPTIONS = [
  { value: "마블", label: "마블 (Marvel)" },
  { value: "버닝", label: "버닝 (Burning)" },
  { value: "황진이", label: "황진이 (Hwangjini)" },
  { value: "라이브", label: "라이브 (Live)" },
] as const

export default function FindIdPage() {
  const [store, setStore] = useState("")
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  function reset() {
    setError("")
    setMaskedEmail(null)
    setNotFound(false)
  }

  async function handleSubmit() {
    reset()
    if (!store) { setError("소속 매장을 선택하세요."); return }
    if (!fullName.trim()) { setError("이름을 입력하세요."); return }
    const phoneDigits = phone.replace(/\D/g, "")
    if (phoneDigits.length < 9 || phoneDigits.length > 15) {
      setError("전화번호 형식을 확인하세요.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/find-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, full_name: fullName.trim(), phone: phoneDigits }),
      })
      if (res.status === 429) {
        setError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.")
        return
      }
      const data = await res.json().catch(() => ({} as { ok?: boolean; email_masked?: string }))
      if (data.ok && typeof data.email_masked === "string") {
        setMaskedEmail(data.email_masked)
      } else {
        setNotFound(true)
      }
    } catch {
      setError("서버 오류 또는 네트워크 문제로 요청을 보낼 수 없습니다.")
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
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">아이디 찾기</h1>
            <p className="mt-2 text-slate-400">
              가입 시 등록한 매장·이름·전화번호로 마스킹된 이메일을 확인할 수 있습니다.
            </p>
          </div>

          <div className="relative rounded-[32px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55),0_0_50px_rgba(37,99,235,0.12)] backdrop-blur-2xl sm:p-8">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

            {maskedEmail ? (
              <div className="py-6 text-center">
                <div className="text-3xl">✓</div>
                <h2 className="mt-3 text-xl font-semibold">등록된 이메일</h2>
                <p className="mt-3 text-2xl font-mono text-cyan-200 tracking-wide">{maskedEmail}</p>
                <p className="mt-3 text-xs text-slate-500">
                  보안을 위해 일부만 표시됩니다. 정확한 이메일이 기억나면 로그인하세요.
                </p>
                <Link
                  href="/login"
                  className="mt-6 inline-block w-full h-12 leading-[3rem] rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)]"
                >
                  로그인 화면으로
                </Link>
              </div>
            ) : notFound ? (
              <div className="py-6 text-center">
                <div className="text-3xl">⚠</div>
                <h2 className="mt-3 text-xl font-semibold">일치하는 계정을 찾을 수 없습니다.</h2>
                <p className="mt-2 text-sm text-slate-400">
                  입력 정보를 확인하거나 운영자에게 문의하세요.
                </p>
                <button
                  onClick={() => { setNotFound(false) }}
                  className="mt-6 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] text-sm text-slate-200 hover:bg-white/[0.07]"
                >
                  다시 시도
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs text-cyan-200/90 tracking-widest">FIND YOUR ID</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">계정 확인</h2>
                  <p className="mt-1 text-sm text-slate-400">세 가지 정보가 모두 일치해야 합니다.</p>
                </div>

                <div className="mt-6 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">소속 매장</label>
                    <select
                      value={store}
                      onChange={(e) => setStore(e.target.value)}
                      className="w-full bg-transparent text-base outline-none [&>option]:bg-[#0A1222]"
                    >
                      <option value="">매장을 선택하세요</option>
                      {STORE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">이름</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="실명"
                    />
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 py-3">
                    <label className="block text-xs font-medium tracking-wide text-slate-400 mb-2">전화번호</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      className="w-full bg-transparent text-base outline-none placeholder:text-slate-500"
                      placeholder="01012345678"
                    />
                  </div>
                </div>

                {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="mt-5 h-14 w-full rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.45)] disabled:opacity-50"
                >
                  {loading ? "확인 중..." : "아이디 찾기"}
                </button>

                <p className="mt-4 text-center text-xs text-slate-500">
                  계정이 없나요?{" "}
                  <Link href="/signup" className="text-cyan-300 hover:underline">가입 신청</Link>
                  {" · "}
                  <Link href="/login" className="text-cyan-300 hover:underline">로그인</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
