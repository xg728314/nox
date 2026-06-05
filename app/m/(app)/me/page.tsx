"use client"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useToast, haptic } from "../../_components/Toast"
import { useMe } from "../../_hooks/useMobileData"
import { apiFetch } from "@/lib/apiFetch"
import { initialOf } from "../../_lib/format"

export default function MePage() {
  const { data, isLoading } = useMe()
  const toast = useToast()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    setLoggingOut(true)
    haptic(20)
    try {
      await apiFetch("/api/auth/logout", { method: "POST" })
    } catch {
      /* best-effort */
    } finally {
      toast("로그아웃 완료", "success")
      router.push("/login")
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="내 정보" backHref="/m" />

      <div className="px-5 pb-24">
        {/* 프로필 카드 */}
        <div className="bg-white rounded-3xl p-5 border border-[#D8D2C8]/60 mb-4 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-[26px] font-extrabold flex items-center justify-center shrink-0">
            {initialOf(data?.full_name ?? "?")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-extrabold tracking-tight truncate">
              {isLoading ? "—" : data?.full_name ?? "이름 없음"}
            </div>
            <div className="text-[11px] font-semibold text-[#7A746A] mt-0.5 truncate">
              {data?.store_name ?? "—"} · {data?.store_floor != null ? `${data.store_floor}층` : "—"}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-extrabold text-[#A87D45] bg-[#C49B61]/15 px-2 py-0.5 rounded-full">
              {data?.role === "owner"
                ? "사장"
                : data?.role === "manager"
                  ? "실장"
                  : data?.role === "hostess"
                    ? "아가씨"
                    : data?.role ?? "—"}
            </div>
          </div>
        </div>

        {/* 메뉴 그룹 */}
        <Group title="매장">
          <Row href="/m/store" label="매장 상세" icon="🏪" />
          <Row href="/m/store/settings" label="매장 설정 (단가/페널티)" icon="⚙" />
        </Group>

        <Group title="계정 보안">
          <Row
            href="/security"
            label={`MFA ${data?.mfa_enabled ? "활성" : "비활성"}`}
            icon="🔐"
            badge={data?.mfa_enabled ? "ON" : "OFF"}
          />
          <Row href="/reset-password" label="비밀번호 변경" icon="🔑" />
        </Group>

        <Group title="앱">
          <Row href="/m/_arch/storyboard.html" label="사용 설명서" icon="📖" external />
          <Row href="/help" label="문제 신고 / 도움" icon="🆘" />
        </Group>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="w-full mt-4 bg-red-50 text-red-600 rounded-2xl py-3 text-[13px] font-extrabold border border-red-200 active:bg-red-100 disabled:opacity-60"
        >
          {loggingOut ? "로그아웃 중..." : "로그아웃"}
        </button>

        <div className="text-center text-[10px] text-[#7A746A] mt-4 mb-2">
          스태프동기화 v2 · {data?.is_super_admin && "super_admin · "}
          membership {data?.membership_id?.slice(0, 8) ?? "—"}…
        </div>
      </div>

      <TabBar />
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider px-1 mb-1.5">{title}</div>
      <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">{children}</div>
    </div>
  )
}

function Row({
  href,
  label,
  icon,
  badge,
  external,
}: {
  href: string
  label: string
  icon?: string
  badge?: string
  external?: boolean
}) {
  const Comp: React.ElementType = external ? "a" : Link
  const extraProps = external ? { target: "_blank", rel: "noopener noreferrer" } : {}
  return (
    <Comp
      href={href}
      {...extraProps}
      className="flex items-center gap-3 px-4 py-3.5 no-underline text-[#2D2B26] border-b border-[#D8D2C8]/40 last:border-b-0 active:bg-[#EFEBE3]"
    >
      {icon && <span className="text-[16px]">{icon}</span>}
      <span className="flex-1 text-[13px] font-bold">{label}</span>
      {badge && (
        <span className="text-[9px] font-extrabold text-[#A87D45] bg-[#C49B61]/15 px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <span className="text-[14px] text-[#D8D2C8]">›</span>
    </Comp>
  )
}
