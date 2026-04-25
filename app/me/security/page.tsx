"use client"

/**
 * /me/security — MFA setup / disable / 백업코드 재발급.
 *
 * R26: backup codes 가 R25 에서 발급 가능해졌지만 enable 자체를 호출하는
 *   UI 가 없었음. 이 페이지가 그 통로.
 *
 * 흐름:
 *   1. POST /api/auth/mfa/setup            → secret_base32 + otpauth_uri
 *   2. 사용자 인증기 앱에 secret 등록 → 6자리 코드 입력
 *   3. POST /api/auth/mfa/enable { code }  → backup_codes 8개 1회 노출
 *   4. 사용자 코드 보관 (인쇄/저장) → "확인" 누르면 화면에서 즉시 폐기
 *
 * 보안 원칙:
 *   - secret_base32 은 한 번만 표시. 새로고침 시 사라짐 (state 만 유지).
 *   - QR 코드 외부 서비스(api.qrserver 등) 호출 금지 — secret 유출.
 *   - 텍스트 + otpauth:// 딥링크만 사용 (모바일에서 인증기 자동 오픈).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Phase = "loading" | "no_mfa" | "setup_pending" | "enabled" | "showing_codes"

export default function SecurityPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  // setup 단계 state
  const [secretBase32, setSecretBase32] = useState("")
  const [otpauthUri, setOtpauthUri] = useState("")
  const [code, setCode] = useState("")

  // 코드 표시 단계 state
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [warning, setWarning] = useState("")

  // disable / regen state
  const [actionCode, setActionCode] = useState("")
  const [remaining, setRemaining] = useState<number | null>(null)

  // 초기 상태 조회
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await apiFetch("/api/auth/me")
        if (!alive) return
        if (res.status === 401 || res.status === 403) {
          router.push("/login")
          return
        }
        const data = await res.json().catch(() => ({}))
        const mfa = !!(data?.mfa_enabled || data?.mfaEnabled)
        if (typeof data?.backup_codes_remaining === "number") {
          setRemaining(data.backup_codes_remaining)
        }
        setPhase(mfa ? "enabled" : "no_mfa")
      } catch {
        setError("상태 조회 실패")
        setPhase("no_mfa")
      }
    })()
    return () => { alive = false }
  }, [router])

  async function startSetup() {
    setBusy(true)
    setError("")
    try {
      const res = await apiFetch("/api/auth/mfa/setup", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || "MFA 설정 시작 실패")
        return
      }
      setSecretBase32(data.secret_base32 || "")
      setOtpauthUri(data.otpauth_uri || "")
      setPhase("setup_pending")
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnable() {
    if (!/^\d{6}$/.test(code)) {
      setError("6자리 코드를 입력하세요.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await apiFetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || "코드 확인 실패")
        return
      }
      setBackupCodes(Array.isArray(data.backup_codes) ? data.backup_codes : [])
      setWarning(data.backup_codes_warning || "")
      setSecretBase32("")
      setOtpauthUri("")
      setCode("")
      setPhase("showing_codes")
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(false)
    }
  }

  async function regenerateCodes() {
    if (!/^\d{6}$/.test(actionCode)) {
      setError("현재 인증기의 6자리 코드를 입력하세요.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await apiFetch("/api/auth/mfa/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp_code: actionCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || "재발급 실패")
        return
      }
      setBackupCodes(Array.isArray(data.plain) ? data.plain : [])
      setWarning(data.warning || "")
      setActionCode("")
      setPhase("showing_codes")
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(false)
    }
  }

  async function disableMfa() {
    if (!/^\d{6}$/.test(actionCode)) {
      setError("현재 인증기의 6자리 코드를 입력하세요.")
      return
    }
    if (!confirm("MFA 를 비활성화하면 모든 백업 코드도 폐기됩니다. 계속하시겠습니까?")) return
    setBusy(true)
    setError("")
    try {
      const res = await apiFetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: actionCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || "비활성화 실패")
        return
      }
      setActionCode("")
      setPhase("no_mfa")
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(false)
    }
  }

  function copyToClipboard(text: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text)
      }
    } catch { /* noop */ }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">🔐 보안 설정</span>
        <div className="w-16" />
      </div>

      <div className="px-4 py-4 space-y-4 max-w-xl mx-auto">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        {phase === "loading" && (
          <div className="text-center text-sm text-slate-400 py-12">불러오는 중...</div>
        )}

        {/* 1) 미설정 — MFA 시작 안내 */}
        {phase === "no_mfa" && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
            <div>
              <div className="text-sm font-semibold text-amber-200">2단계 인증 (MFA) 미사용</div>
              <p className="mt-2 text-xs text-amber-100/80 leading-relaxed">
                MFA 를 활성화하면 비밀번호가 유출되어도 인증기 앱 코드 없이는 로그인할 수 없습니다.
                활성화 시 <b>백업 코드 8개</b>가 발급됩니다 — 폰을 분실해도 로그인 가능한 유일한 통로입니다.
              </p>
            </div>
            <button
              onClick={startSetup}
              disabled={busy}
              className="w-full py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-semibold text-sm disabled:opacity-50"
            >
              {busy ? "준비 중..." : "MFA 설정 시작"}
            </button>
          </div>
        )}

        {/* 2) setup pending — secret 표시 + 코드 입력 */}
        {phase === "setup_pending" && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
            <div>
              <div className="text-sm font-semibold text-cyan-200 mb-2">1단계: 인증기 앱에 등록</div>
              <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                Google Authenticator / Microsoft Authenticator / Authy 등에서 <b>수동 입력</b>으로 등록.
              </p>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] text-slate-500 mb-1">계정명: NOX</div>
                <div className="font-mono text-sm tracking-wider break-all text-cyan-100">{secretBase32}</div>
                <button
                  onClick={() => copyToClipboard(secretBase32)}
                  className="mt-2 text-[11px] text-cyan-400 underline"
                >secret 복사</button>
              </div>
              {otpauthUri && (
                <a
                  href={otpauthUri}
                  className="mt-2 block text-[11px] text-cyan-400 underline"
                >
                  📱 모바일에서 자동 등록 (otpauth:// 링크)
                </a>
              )}
            </div>

            <div className="border-t border-white/[0.05] pt-4">
              <div className="text-sm font-semibold text-cyan-200 mb-2">2단계: 6자리 코드 확인</div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={e => e.key === "Enter" && confirmEnable()}
                className="w-full rounded-xl border border-white/10 bg-[#0A1222]/80 px-4 py-3 text-base tracking-[0.4em] outline-none placeholder:text-slate-600"
                placeholder="000000"
                autoFocus
              />
              <button
                onClick={confirmEnable}
                disabled={busy}
                className="mt-3 w-full py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-semibold text-sm disabled:opacity-50"
              >
                {busy ? "확인 중..." : "확인하고 활성화"}
              </button>
            </div>
          </div>
        )}

        {/* 3) backup codes 표시 — 1회만 */}
        {phase === "showing_codes" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-4">
            <div>
              <div className="text-sm font-semibold text-emerald-200 mb-2">✓ 백업 코드 8개</div>
              {warning && (
                <p className="text-[11px] text-amber-200/90 leading-relaxed mb-3">
                  ⚠️ {warning}
                </p>
              )}
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 grid grid-cols-2 gap-2 font-mono text-sm">
                {backupCodes.map((c, i) => (
                  <div key={i} className="text-cyan-100 tracking-wider">{c}</div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => copyToClipboard(backupCodes.join("\n"))}
                  className="flex-1 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-slate-300"
                >전체 복사</button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-slate-300"
                >인쇄</button>
              </div>
            </div>
            <button
              onClick={() => {
                setBackupCodes([])
                setWarning("")
                setPhase("enabled")
              }}
              className="w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 font-semibold text-sm"
            >
              저장 완료 — 화면에서 폐기
            </button>
          </div>
        )}

        {/* 4) MFA 활성 — disable / regen */}
        {phase === "enabled" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-sm font-semibold text-emerald-200">✓ MFA 활성</div>
              <p className="mt-1 text-[11px] text-emerald-100/70">
                로그인 시 인증기 앱의 6자리 코드 또는 백업 코드가 필요합니다.
              </p>
              {remaining !== null && (
                <div className={`mt-2 text-[11px] ${remaining <= 2 ? "text-amber-300" : "text-slate-400"}`}>
                  남은 백업 코드: <b>{remaining}</b>개{remaining <= 2 ? " — 곧 재발급 권장" : ""}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-200">백업 코드 재발급</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                새 8개를 발급하면 <b>기존 백업 코드는 모두 폐기</b>됩니다.
                현재 인증기 앱의 6자리 코드를 입력하세요.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={actionCode}
                onChange={e => setActionCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-white/10 bg-[#0A1222]/80 px-4 py-3 text-base tracking-[0.4em] outline-none placeholder:text-slate-600"
                placeholder="000000"
              />
              <div className="flex gap-2">
                <button
                  onClick={regenerateCodes}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? "..." : "새 백업 코드 발급"}
                </button>
                <button
                  onClick={disableMfa}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-semibold disabled:opacity-50"
                >
                  MFA 비활성화
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
