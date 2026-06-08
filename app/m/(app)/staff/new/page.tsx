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

/**
 * 새 스태프 등록 — /m/staff/new
 *
 * 흐름:
 *  1. 실장이 이름 + 전화 + 이메일 입력
 *  2. POST /api/admin/members/create
 *       role='hostess', target_store_uuid=본인매장
 *  3. 백엔드:
 *     - 신규 user 면 supabase auth user 생성 + temp_password 발급
 *     - store_memberships INSERT (status='approved', is_primary 자동)
 *     - hostesses INSERT (manager_membership_id=본인 자동)
 *     - audit_events 기록
 *  4. 실장에게 temp_password 표시 → 스태프에게 공유 → 스태프 첫 로그인 시
 *     비밀번호 강제 변경 (must_change_password=true)
 *
 * 제한 (백엔드 권한):
 *  - manager → hostess 만 본인 매장에 추가 가능
 *  - owner → owner 외 (manager/staff/hostess) 추가 가능 (현재 UI 는 hostess 만)
 */
export default function StaffNewPage() {
  const me = useMe()
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    membership_id: string
    temp_password: string | null
    existing_user: boolean
  } | null>(null)

  const ready = name.trim().length >= 1 && phone.replace(/\D/g, "").length >= 9 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  async function submit() {
    if (!ready || submitting || !me.data?.store_uuid) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/admin/members/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ""),
          role: "hostess",
          target_store_uuid: me.data.store_uuid,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = json?.error ?? `HTTP_${res.status}`
        const msg = json?.message ?? "스태프 등록 실패"
        throw new Error(`${code}: ${msg}`)
      }
      // 성공 — 결과 표시 + 식구 캐시 무효화
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/building/hostesses")
      setResult({
        membership_id: json.membership_id,
        temp_password: json.temp_password ?? null,
        existing_user: !!json.existing_user,
      })
      toast("스태프 등록 완료", "success")
    } catch (e) {
      const msg = (e as Error).message
      toast(`실패: ${msg}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // ─── 등록 완료 후 결과 화면 ───
  if (result) {
    return (
      <div className="flex flex-col min-h-full">
        <PageHeader title="등록 완료" backHref="/m/staff" />
        <div className="px-5 pb-24 flex flex-col gap-3">
          <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-[12px] font-bold text-green-700">
            ✓ <b>{name}</b> 님이 매장에 등록됐습니다
          </div>

          {result.existing_user ? (
            <div className="bg-white border border-[#D8D2C8]/60 rounded-2xl p-4">
              <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-1">
                기존 계정 연결
              </div>
              <div className="text-[12px] font-bold text-[#2D2B26]">
                이 이메일은 이미 NOX 계정이 있습니다.
                <br />
                별도의 비밀번호 안내가 필요 없습니다 — 기존 비밀번호로 로그인하면 본 매장도 보입니다.
              </div>
            </div>
          ) : result.temp_password ? (
            <div className="bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] border-2 border-[#C49B61]/40 rounded-2xl p-4">
              <div className="text-[10px] font-extrabold text-[#A87D45] uppercase tracking-wider mb-2">
                🔑 스태프에게 공유할 임시 비밀번호
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
                    toast("복사 실패 — 길게 눌러 직접 복사하세요", "info")
                  }
                  haptic(15)
                }}
                className="w-full mt-2 bg-[#2D2B26] text-white rounded-xl py-2.5 text-[12px] font-extrabold"
              >
                📋 복사
              </button>
              <div className="text-[10px] text-[#7A746A] font-semibold mt-2 leading-relaxed">
                · 이메일: <b>{email}</b>
                <br />· 스태프가 첫 로그인 시 비밀번호를 새로 설정해야 합니다.
                <br />· 임시 비밀번호는 이 화면을 떠나면 다시 볼 수 없습니다. <b>지금 카톡으로 보내세요.</b>
              </div>
            </div>
          ) : null}

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

      <div className="px-5 pb-32 flex flex-col gap-4">
        <div className="text-[11px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          본인 매장 (<b>{me.data?.store_name ?? "—"}</b>) 의 새 식구를 등록합니다.
          <br />
          등록 즉시 본인 담당으로 자동 바인딩됩니다.
        </div>

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

        <Field label="전화번호" required hint="숫자만 입력해도 OK (예: 01012345678)">
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

        <Field label="이메일" required hint="로그인 ID 로 사용됩니다">
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

        <div className="text-[10px] text-[#7A746A] font-semibold leading-relaxed mt-1 px-1">
          · 등록 직후 임시 비밀번호가 화면에 표시됩니다 (1회만).
          <br />· 스태프에게 임시 비밀번호 + 이메일을 카톡으로 보내주세요.
          <br />· 첫 로그인 시 스태프가 직접 새 비밀번호를 설정합니다.
        </div>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#D8D2C8]/60 px-5 py-3 flex gap-2"
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
          {submitting ? "등록 중..." : "스태프 등록"}
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
