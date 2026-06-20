"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useToast, haptic } from "../../../_components/Toast"
import { useMe } from "../../../_hooks/useMobileData"
import { invalidateApi } from "../../../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../_lib/cn"

/**
 * 새 스태프 등록 — /m/staff/new
 *
 * 두 가지 방식 (실장 선택):
 *
 * A. 사전 등록 (이름 + 전화) — Recommended for most cases
 *    · 백엔드: POST /api/manager/hostesses/pre-register
 *    · hostess_pre_registrations row 생성 (auth user 없음)
 *    · 스태프는 나중에 /signup 으로 가입하면 전화 매칭 자동 연동
 *    · 가장 빠름 — 이메일/임시비밀번호 공유 불필요
 *
 * B. 이메일 초대 (이름 + 전화 + 이메일)
 *    · 백엔드: POST /api/admin/members/create (role='hostess')
 *    · 즉시 auth user + 임시 비밀번호 발급 → 실장이 스태프에게 공유
 *    · 스태프는 이메일/임시 비번으로 즉시 로그인 가능
 */
type Mode = "pre-register" | "invite"

export default function StaffNewPage() {
  const me = useMe()
  const router = useRouter()
  const toast = useToast()

  const [mode, setMode] = useState<Mode>("pre-register")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<
    | { kind: "pre-register"; name: string; phone: string }
    | { kind: "invite"; name: string; email: string; temp_password: string | null; existing_user: boolean }
    | null
  >(null)

  const phoneDigits = phone.replace(/\D/g, "")
  const ready =
    name.trim().length >= 1 &&
    phoneDigits.length >= 9 &&
    (mode === "pre-register" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))

  async function submit() {
    if (!ready || submitting || !me.data?.store_uuid) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      if (mode === "pre-register") {
        const res = await apiFetch("/api/manager/hostesses/pre-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            phone: phoneDigits,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(json?.message ?? `HTTP ${res.status}`)
        }
        invalidateApi("/api/manager/hostesses")
        setResult({ kind: "pre-register", name: name.trim(), phone: phoneDigits })
        toast("사전등록 완료", "success")
      } else {
        const res = await apiFetch("/api/admin/members/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            full_name: name.trim(),
            phone: phoneDigits,
            role: "hostess",
            target_store_uuid: me.data.store_uuid,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(json?.message ?? `HTTP ${res.status}`)
        }
        invalidateApi("/api/manager/hostesses")
        invalidateApi("/api/building/hostesses")
        setResult({
          kind: "invite",
          name: name.trim(),
          email: email.trim().toLowerCase(),
          temp_password: json.temp_password ?? null,
          existing_user: !!json.existing_user,
        })
        toast("초대 완료", "success")
      }
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // ─── 결과 화면 ───
  if (result) {
    return (
      <div className="flex flex-col min-h-full pb-8">
        <PageHeader title="등록 완료" backHref="/m/staff" />
        <div className="px-5 pb-24 flex flex-col gap-3">
          {result.kind === "pre-register" ? (
            <>
              <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-[12px] font-bold text-green-700">
                ✓ <b>{result.name}</b> 식구 등록 완료
              </div>
              <div className="bg-white border border-[#D8D2C8]/60 rounded-2xl p-4">
                <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-1">
                  바로 가능
                </div>
                <div className="text-[12px] font-bold text-[#2D2B26] leading-relaxed">
                  · 즉시 세션 등록, 정산, 채팅 참여 가능합니다.
                  <br />· 스태프 목록에 정식 식구로 표시됨.
                </div>
              </div>
              <div className="bg-white border border-[#D8D2C8]/60 rounded-2xl p-4">
                <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-wider mb-1">
                  스태프 본인 가입 시 (선택)
                </div>
                <div className="text-[12px] font-bold text-[#2D2B26] leading-relaxed">
                  · 본인이 NOX 가입을 원하면 <b>같은 전화번호({result.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")}) + 이름</b> 으로 가입.
                  <br />· 매칭 시 본인 계정으로 자동 전환 (기록 그대로 유지).
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-[12px] font-bold text-green-700">
                ✓ <b>{result.name}</b> 매장 초대 완료
              </div>
              {result.existing_user ? (
                <div className="bg-white border border-[#D8D2C8]/60 rounded-2xl p-4">
                  <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-1">
                    기존 계정 연결
                  </div>
                  <div className="text-[12px] font-bold text-[#2D2B26]">
                    이미 NOX 계정 있음 — 기존 비번으로 로그인하면 본 매장 즉시 보임.
                  </div>
                </div>
              ) : result.temp_password ? (
                <div className="bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] border-2 border-[#C49B61]/40 rounded-2xl p-4">
                  <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-wider mb-2">
                    🔑 임시 비밀번호 (1회만 표시)
                  </div>
                  <div className="bg-white rounded-xl px-3 py-3 font-mono text-[14px] font-extrabold text-center tracking-wide select-all border border-[#D8D2C8]">
                    {result.temp_password}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result.temp_password ?? "")
                        toast("복사됨", "success")
                      } catch {
                        toast("복사 실패 — 길게 눌러 복사", "info")
                      }
                      haptic(15)
                    }}
                    className="w-full mt-2 bg-[#2D2B26] text-white rounded-xl py-2.5 text-[12px] font-extrabold"
                  >
                    📋 복사
                  </button>
                  <div className="text-[10px] text-[#7A746A] font-semibold mt-2 leading-relaxed">
                    · 이메일: <b>{result.email}</b>
                    <br />· 카톡으로 즉시 공유하세요. 화면 떠나면 다시 볼 수 없음.
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setResult(null)
                setName("")
                setPhone("")
                setEmail("")
              }}
              className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
            >
              한 명 더 등록
            </button>
            <Link
              href="/m/staff"
              className="flex-1 bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold no-underline text-center"
            >
              스태프 목록
            </Link>
          </div>
        </div>
        <TabBar />
      </div>
    )
  }

  // ─── 입력 화면 ───
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="새 스태프 등록" backHref="/m/staff" />

      <div className="flex-1 px-5 pb-4 flex flex-col gap-4">
        {/* 모드 토글 */}
        <div className="flex bg-[#EFEBE3] rounded-2xl p-1">
          {(
            [
              { k: "pre-register", lbl: "사전 등록", sub: "이름+전화" },
              { k: "invite", lbl: "이메일 초대", sub: "임시 비번 발급" },
            ] as const
          ).map((m) => (
            <button
              key={m.k}
              type="button"
              onClick={() => setMode(m.k)}
              className={cn(
                "flex-1 py-2 px-1 rounded-xl transition-colors",
                mode === m.k ? "bg-white shadow-sm" : "",
              )}
            >
              <div
                className={cn(
                  "text-[12px] font-extrabold tracking-tight",
                  mode === m.k ? "text-[#2D2B26]" : "text-[#7A746A]",
                )}
              >
                {m.lbl}
              </div>
              <div
                className={cn(
                  "text-[9px] font-bold mt-0.5",
                  mode === m.k ? "text-[#A87D45]" : "text-[#7A746A]",
                )}
              >
                {m.sub}
              </div>
            </button>
          ))}
        </div>

        {mode === "pre-register" ? (
          <div className="text-[11px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
            · 본인 매장 (<b>{me.data?.store_name ?? "—"}</b>) 에 이름+전화만으로 사전 등록.
            <br />· 스태프가 NOX 가입할 때 <b>같은 전화번호</b>면 자동 연동.
            <br />· 가입 전엔 세션/정산 참여 불가, 목록에서 "가입 대기" 표시.
          </div>
        ) : (
          <div className="text-[11px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
            · 본인 매장 (<b>{me.data?.store_name ?? "—"}</b>) 에 즉시 초대.
            <br />· 임시 비밀번호가 화면에 1회 표시 → 카톡으로 공유.
            <br />· 첫 로그인 시 스태프가 비밀번호를 새로 설정.
          </div>
        )}

        <Field label="이름" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="실명 또는 활동명"
            autoComplete="off"
            className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-semibold outline-none focus:border-[#C49B61]"
          />
        </Field>

        <Field label="전화번호" required hint="숫자만 입력해도 OK">
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            autoComplete="off"
            className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-semibold outline-none focus:border-[#C49B61]"
          />
        </Field>

        {mode === "invite" && (
          <Field label="이메일" required hint="로그인 ID">
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hostess@example.com"
              autoComplete="off"
              autoCapitalize="off"
              className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-semibold outline-none focus:border-[#C49B61]"
            />
          </Field>
        )}
      </div>

      <div
        className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#D8D2C8]/60 px-5 py-3 flex gap-2 z-10"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!ready || submitting}
          className="flex-[2] bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
        >
          {submitting ? "등록 중..." : mode === "pre-register" ? "사전 등록" : "초대 발송"}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider">
          {label}
          {required && <span className="text-red-600 ml-0.5">*</span>}
        </span>
        {hint && <span className="text-[9px] font-semibold text-[#7A746A]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
