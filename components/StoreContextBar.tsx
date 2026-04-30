"use client"

/**
 * StoreContextBar — 모든 보호 페이지 상단에 표시되는 슬림 banner.
 *
 * 2026-04-30:
 *   - 사용자 본인 소속 매장명 + 역할을 항상 표시 (운영자 요청).
 *   - super_admin 가 매장/역할 override 중일 때는 fuchsia 색으로 강조 +
 *     "원래로" 버튼 제공 (어떤 페이지에서든 1탭으로 자기 매장으로 복귀).
 *   - /login, /signup, /reset-password 같은 인증 전 화면에서는 자동 숨김
 *     (useCurrentProfile 이 needsLogin → null 반환).
 *
 * 위치: layout.tsx 의 body 최상단 자식. 모든 페이지 위에 sticky.
 *   기존 페이지 헤더와 겹치지 않도록 슬림 (h-8) 으로 유지.
 */

import { usePathname, useRouter } from "next/navigation"
import { useCurrentProfile, invalidateCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { apiFetch } from "@/lib/apiFetch"
import { useState } from "react"

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/reset-password",
  "/find-id",
]

function roleLabel(role: string | undefined): string {
  if (role === "owner") return "사장"
  if (role === "manager") return "실장"
  if (role === "staff") return "스태프"
  if (role === "hostess") return "스태프"
  if (role === "waiter") return "웨이터"
  return role ?? ""
}

export default function StoreContextBar() {
  const pathname = usePathname()
  const router = useRouter()
  const me = useCurrentProfile()
  const [busy, setBusy] = useState(false)

  // 인증 전 화면에선 숨김
  if (pathname && HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null
  }
  // 로딩 / 미인증 → 숨김
  if (!me) return null

  const isSuperAdmin = me.is_super_admin === true
  // super_admin 의 base 가 owner 인 경우 (xg728314), 현재 role 이 owner 가
  // 아니면 override 중이라고 추정. base role 을 정확히 알려면 별도 API
  // 가 필요한데 현재는 휴리스틱으로 충분 (운영자 자기 검증용).
  const isOverridden = isSuperAdmin && me.role !== "owner"

  async function clearOverride() {
    if (busy) return
    setBusy(true)
    try {
      await apiFetch("/api/auth/active-context", { method: "DELETE" })
      invalidateCurrentProfile()
      window.location.href = "/owner"
    } catch {
      setBusy(false)
    }
  }

  const baseClasses = "sticky top-0 z-40 w-full px-3 py-1.5 text-[11px] flex items-center justify-between border-b backdrop-blur-sm"
  const tone = isOverridden
    ? "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-100"
    : "bg-black/60 border-white/5 text-slate-300"

  return (
    <div className={`${baseClasses} ${tone}`}>
      <div className="flex items-center gap-2 min-w-0">
        {isSuperAdmin && (
          <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/25 text-fuchsia-100 text-[10px] font-bold shrink-0">
            🛡️ 운영자
          </span>
        )}
        <span className="font-semibold truncate">
          {me.store_name ?? "(매장 미상)"}
        </span>
        <span className="text-slate-500 shrink-0">·</span>
        <span className="shrink-0">{roleLabel(me.role)}</span>
        {isOverridden && (
          <span className="text-fuchsia-300/80 text-[10px] shrink-0">(view)</span>
        )}
      </div>

      {isOverridden && (
        <button
          onClick={clearOverride}
          disabled={busy}
          className="px-2 py-0.5 rounded bg-fuchsia-500/30 hover:bg-fuchsia-500/40 text-fuchsia-50 text-[10px] font-semibold border border-fuchsia-400/40 disabled:opacity-50 shrink-0"
        >
          {busy ? "..." : "← 원래로"}
        </button>
      )}
    </div>
  )
}
