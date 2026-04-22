"use client"

/**
 * 회원 생성 — privileged account creation UI.
 *
 * 🔒 POLICY (locked):
 *   - 이 페이지는 사장(owner) / 운영자(super_admin) 전용.
 *   - manager 는 이 페이지에 진입해도 서버가 403 을 반환.
 *   - hostess / public 은 middleware 가 차단 (/admin = OWNER_ONLY tree).
 *   - 이 페이지로는 **실장(manager) / 스태프(staff)** 만 생성 가능.
 *     owner 는 여기서 생성 불가 (서버가 403). super_admin 만 별도 경로.
 *   - 아가씨(hostess) 는 공개 signup + 승인 흐름 별도.
 *
 * 서버측 엔드포인트:
 *   POST /api/admin/members/create
 *
 * 임시 비밀번호 처리:
 *   - 신규 유저 생성 시 서버가 temp_password 응답.
 *   - 이 화면에서 **1회만** 표시. 페이지 이탈 또는 "다른 회원 생성"
 *     클릭 시 상태 초기화되어 다시 볼 수 없음.
 *   - 복사 버튼 제공. 이메일/평문 메신저 전송 금지 경고.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfileState } from "@/lib/auth/useCurrentProfile"

type TargetRole = "owner" | "manager" | "staff" | "hostess"

type FormState = {
  target_store_uuid: string
  role: TargetRole | ""
  full_name: string
  phone: string
  email: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SuccessPayload = {
  ok: true
  membership_id: string
  profile_id: string
  existing_user: boolean
  temp_password?: string
  message?: string
}

export default function MemberCreatePage() {
  const router = useRouter()
  const currentState = useCurrentProfileState()
  const profile = currentState.loading === false ? currentState.profile : null
  const callerRole = profile?.role ?? null
  const isSuperAdmin = !!(profile as unknown as { is_super_admin?: boolean } | null)?.is_super_admin
  const callerStoreUuid = profile?.store_uuid ?? ""

  // Caller-scoped role options (matches server permission matrix):
  //   - super_admin → 모든 role 생성 가능
  //   - owner       → 본인 매장에서 manager / staff / hostess 생성
  //   - manager     → 본인 매장에서 hostess 만 생성 (내부 전용 경로)
  //   - 기타        → 페이지 진입 자체가 middleware 에서 차단
  const roleOptions = useMemo<TargetRole[]>(() => {
    if (isSuperAdmin) return ["owner", "manager", "staff", "hostess"]
    if (callerRole === "owner") return ["manager", "staff", "hostess"]
    if (callerRole === "manager") return ["hostess"]
    return []
  }, [isSuperAdmin, callerRole])

  const canUsePage = roleOptions.length > 0

  const [form, setForm] = useState<FormState>({
    target_store_uuid: !isSuperAdmin && callerStoreUuid ? callerStoreUuid : "",
    role: "",
    full_name: "",
    phone: "",
    email: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<SuccessPayload | null>(null)
  const [copied, setCopied] = useState(false)

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function validate(): string | null {
    if (!form.role) return "직책을 선택하세요."
    if (!form.target_store_uuid) return "대상 매장을 지정하세요."
    if (!UUID_RE.test(form.target_store_uuid))
      return "매장 UUID 형식이 올바르지 않습니다."
    if (!form.full_name.trim()) return "이름을 입력하세요."
    const phoneDigits = form.phone.replace(/\D/g, "")
    if (!phoneDigits) return "전화번호를 입력하세요."
    if (phoneDigits.length < 9 || phoneDigits.length > 15)
      return "전화번호 형식을 확인하세요."
    if (!form.email.trim()) return "이메일을 입력하세요."
    if (!EMAIL_RE.test(form.email.trim()))
      return "이메일 형식이 올바르지 않습니다."
    return null
  }

  async function handleSubmit() {
    setError("")
    const v = validate()
    if (v) { setError(v); return }
    setSubmitting(true)
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim(),
        phone: form.phone.replace(/\D/g, ""),
        role: form.role,
        target_store_uuid: form.target_store_uuid.trim(),
      }
      const res = await apiFetch("/api/admin/members/create", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      let data: Record<string, unknown> = {}
      try { data = await res.json() } catch { /* non-JSON */ }

      if (res.status === 401 || res.status === 403) {
        setError((data.message as string) || "생성 권한이 없습니다.")
        return
      }
      if (!res.ok) {
        setError((data.message as string) || (data.error as string) || "회원 생성에 실패했습니다.")
        return
      }
      setResult(data as unknown as SuccessPayload)
    } catch {
      setError("서버 오류 또는 네트워크 문제로 요청을 보낼 수 없습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  async function copyTempPassword() {
    const pw = result?.temp_password
    if (!pw) return
    try {
      await navigator.clipboard.writeText(pw)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // navigator.clipboard unavailable (e.g. http) — fall back to prompt
      try { window.prompt("복사하세요 (Ctrl+C)", pw) } catch { /* ignore */ }
    }
  }

  function resetAndAddAnother() {
    setResult(null)
    setError("")
    setCopied(false)
    setForm({
      target_store_uuid: !isSuperAdmin && callerStoreUuid ? callerStoreUuid : "",
      role: "",
      full_name: "",
      phone: "",
      email: "",
    })
  }

  if (currentState.loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }
  if (currentState.needsLogin) {
    router.push("/login")
    return null
  }
  if (!canUsePage) {
    return (
      <div className="min-h-screen bg-[#030814] text-white p-6">
        <div className="max-w-lg mx-auto rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <h1 className="text-xl font-semibold">회원 생성</h1>
          <p className="mt-3 text-sm text-slate-300">
            이 페이지는 <b>사장(owner)</b> 또는 <b>운영자(super_admin)</b> 전용입니다.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            현재 role: {callerRole ?? "unknown"}
          </p>
          <Link href="/counter" className="inline-block mt-4 text-cyan-400 text-sm">
            ← 카운터로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => router.push(isSuperAdmin ? "/super-admin" : callerRole === "manager" ? "/manager" : "/owner")}
            className="text-cyan-400 text-sm"
          >
            ← 돌아가기
          </button>
          <span className="font-semibold">회원 생성</span>
          <div className="w-8" />
        </div>

        <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
          {/* 정책 안내 */}
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-[13px] text-amber-100/90">
            <div className="font-medium">회원 생성 권한</div>
            <p className="mt-1 text-amber-100/70">
              이 페이지는 <b>사장 · 실장 · 스테프 · 아가씨</b> 계정을 내부에서 직접
              생성합니다. <b>아가씨</b>는 공개 회원가입 경로에서 금지되어 있으며,
              실장 또는 사장만 이 페이지로 생성할 수 있습니다.
            </p>
            <p className="mt-2 text-amber-100/60 text-[12px]">
              사장(owner) 계정은 <b>운영자(super_admin)</b>만 생성할 수 있습니다.
              실장(manager)은 본인 매장의 <b>아가씨</b>만 생성할 수 있습니다.
              사장은 본인 매장에서 실장 · 스테프 · 아가씨를 생성할 수 있습니다.
            </p>
          </div>

          {result ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">✓</span>
                <h2 className="text-lg font-semibold">회원이 생성되었습니다</h2>
              </div>
              <p className="text-sm text-slate-300">{result.message}</p>

              <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-sm space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">이메일</div>
                  <div className="font-mono text-cyan-200 break-all">{form.email}</div>
                </div>
                {result.temp_password && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">임시 비밀번호</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="font-mono text-amber-200 break-all text-base flex-1">
                        {result.temp_password}
                      </div>
                      <button
                        onClick={copyTempPassword}
                        className="h-8 px-3 rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-200 text-xs hover:bg-amber-400/20 flex-shrink-0"
                      >
                        {copied ? "복사됨 ✓" : "복사"}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-300/80">
                      ⚠ 이 비밀번호는 <b>1회만 확인 가능합니다. 안전하게 전달하세요.</b>
                      {" "}이메일/카카오톡 평문 전송 금지.
                    </p>
                  </div>
                )}
                {result.existing_user && (
                  <p className="text-[11px] text-slate-400">
                    기존 계정에 새 매장 멤버십이 추가되었습니다. 해당 사용자의 기존
                    비밀번호는 변경되지 않았습니다.
                  </p>
                )}
                <div className="pt-1 border-t border-white/5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">membership_id</div>
                  <div className="font-mono text-[11px] text-slate-400 break-all">{result.membership_id}</div>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={resetAndAddAnother}
                  className="flex-1 h-11 rounded-xl bg-cyan-500/20 text-cyan-200 text-sm font-medium border border-cyan-500/30"
                >
                  다른 회원 생성
                </button>
                <button
                  onClick={() => router.push(isSuperAdmin ? "/super-admin" : callerRole === "manager" ? "/manager" : "/owner")}
                  className="flex-1 h-11 rounded-xl bg-white/5 text-slate-300 text-sm font-medium border border-white/10"
                >
                  대시보드로
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">직책</label>
                <select
                  value={form.role}
                  onChange={(e) => update("role", e.target.value as TargetRole | "")}
                  className="w-full bg-[#0A1222] border border-white/10 rounded-lg px-3 py-2 text-sm [&>option]:bg-[#0A1222]"
                >
                  <option value="">직책을 선택하세요</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r === "owner" ? "사장 (owner)"
                        : r === "manager" ? "실장 (manager)"
                        : r === "staff" ? "스테프 (staff)"
                        : "아가씨 (hostess)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  대상 매장 (store UUID)
                </label>
                <input
                  type="text"
                  value={form.target_store_uuid}
                  onChange={(e) => update("target_store_uuid", e.target.value)}
                  disabled={!isSuperAdmin}
                  placeholder={isSuperAdmin ? "대상 매장 UUID 를 입력하세요" : "본인 매장 자동 지정"}
                  className="w-full bg-[#0A1222] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-60"
                />
                {!isSuperAdmin && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    사장은 본인 매장 외에는 회원을 생성할 수 없습니다.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">이름</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => update("full_name", e.target.value)}
                  placeholder="실명"
                  className="w-full bg-[#0A1222] border border-white/10 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">전화번호</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="01012345678"
                  className="w-full bg-[#0A1222] border border-white/10 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">이메일</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-[#0A1222] border border-white/10 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full h-12 rounded-xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-sm font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.35)] disabled:opacity-50"
              >
                {submitting ? "생성 중..." : "회원 생성"}
              </button>

              <p className="text-[11px] text-slate-500">
                생성 직후 멤버십이 자동으로 <b>approved</b> 상태로 등록됩니다.
                감사 로그(<code>audit_events</code>) 에 생성자와 함께 기록됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
