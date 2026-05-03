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
 * 2026-05-03 (R-SuperAdminTopSelect):
 *   super_admin 일 때 이 bar 자체에서 [매장 선택 + 권한 선택] dropdown 으로
 *   즉시 전환 가능하게 확장. 이전엔 /owner 의 별도 패널/섹션에서만 가능했는데
 *   카페(/cafe/manage), 정산(/owner/settlement), 카운터(/counter) 등 어디 있든
 *   화면 상단에서 1탭으로 매장/권한을 갈아끼울 수 있어야 운영 효율이 산다.
 *
 *   매장 옵션: /api/super-admin/stores-list (카페 floor=3 + 5/6/7/8층).
 *   권한 옵션: 사장(owner) / 실장(manager) / 스태프(staff).
 *     변경 시 active-context cookie 갱신 + role 별 home (/owner|/manager|/counter)
 *     으로 hard navigate.
 *
 * 위치: layout.tsx 의 body 최상단 자식. 모든 페이지 위에 sticky.
 */

import { usePathname, useRouter } from "next/navigation"
import { useCurrentProfile, invalidateCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { apiFetch } from "@/lib/apiFetch"
import { useEffect, useState } from "react"

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/reset-password",
  "/find-id",
]

type StoreOpt = {
  store_uuid: string
  store_name: string
  floor_no: number | null
}

function roleLabel(role: string | undefined): string {
  if (role === "owner") return "사장"
  if (role === "manager") return "실장"
  if (role === "staff") return "스태프"
  if (role === "hostess") return "스태프"
  if (role === "waiter") return "웨이터"
  return role ?? ""
}

function roleHome(role: string): string {
  if (role === "manager") return "/manager"
  if (role === "staff") return "/counter"
  if (role === "hostess") return "/me"
  return "/owner"
}

export default function StoreContextBar() {
  const pathname = usePathname()
  const router = useRouter()
  const me = useCurrentProfile()
  const [busy, setBusy] = useState(false)
  const [stores, setStores] = useState<StoreOpt[]>([])

  const isSuperAdmin = me?.is_super_admin === true

  // super_admin 일 때만 전 매장 목록 fetch (멤버십 없이도 cookie override 가능).
  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/super-admin/stores-list")
        if (!res.ok || cancelled) return
        const d = await res.json()
        if (!cancelled) setStores((d.stores ?? []) as StoreOpt[])
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [isSuperAdmin])

  // 인증 전 화면에선 숨김
  if (pathname && HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null
  }
  // 로딩 / 미인증 → 숨김
  if (!me) return null

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

  async function switchStore(storeUuid: string) {
    if (!storeUuid || storeUuid === me?.store_uuid || busy) return
    setBusy(true)
    try {
      const res = await apiFetch("/api/auth/active-context", {
        method: "PUT",
        body: JSON.stringify({ store_uuid: storeUuid }),
      })
      if (!res.ok) { setBusy(false); return }
      invalidateCurrentProfile()
      // 매장이 카페(floor=3) 면 /cafe/manage 로, 아니면 현재 페이지 reload.
      const target = stores.find((s) => s.store_uuid === storeUuid)
      if (target?.floor_no === 3) {
        window.location.href = "/cafe/manage"
      } else {
        // 현재가 /cafe/manage 였다면 /owner 로 빠져나옴 (카페→일반 매장 전환).
        if (pathname?.startsWith("/cafe")) {
          window.location.href = "/owner"
        } else {
          window.location.reload()
        }
      }
    } catch {
      setBusy(false)
    }
  }

  async function switchRole(role: string) {
    if (busy) return
    setBusy(true)
    try {
      if (role === "owner") {
        await apiFetch("/api/auth/active-context", { method: "DELETE" })
      } else {
        const res = await apiFetch("/api/auth/active-context", {
          method: "PUT",
          body: JSON.stringify({ role }),
        })
        if (!res.ok) { setBusy(false); return }
      }
      invalidateCurrentProfile()
      window.location.href = roleHome(role)
    } catch {
      setBusy(false)
    }
  }

  const baseClasses = "sticky top-0 z-40 w-full px-3 py-1.5 text-[11px] flex items-center gap-2 border-b backdrop-blur-sm"
  const tone = isOverridden
    ? "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-100"
    : isSuperAdmin
      ? "bg-fuchsia-500/10 border-fuchsia-500/25 text-fuchsia-50"
      : "bg-black/60 border-white/5 text-slate-300"

  // 비-super_admin: 종전 minimal banner 유지.
  if (!isSuperAdmin) {
    return (
      <div className={`${baseClasses} justify-between ${tone}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">
            {me.store_name ?? "(매장 미상)"}
          </span>
          <span className="text-slate-500 shrink-0">·</span>
          <span className="shrink-0">{roleLabel(me.role)}</span>
        </div>
      </div>
    )
  }

  // super_admin: 매장 + 권한 dropdown 통합 헤더.
  const currentRole = (me.role === "manager" || me.role === "staff") ? me.role : "owner"
  return (
    <div className={`${baseClasses} flex-wrap ${tone}`}>
      <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/30 text-fuchsia-50 text-[10px] font-bold shrink-0">
        🛡️ 운영자
      </span>
      <span className="font-semibold truncate max-w-[140px]">
        {me.store_name ?? "(매장 미상)"}
      </span>
      {isOverridden && (
        <span className="text-fuchsia-300/80 text-[10px] shrink-0">(view)</span>
      )}

      <label className="flex items-center gap-1 ml-auto shrink-0">
        <span className="text-[10px] text-fuchsia-300/80">매장</span>
        <select
          value={me.store_uuid ?? ""}
          onChange={(e) => switchStore(e.target.value)}
          disabled={busy || stores.length === 0}
          className="bg-[#0A1222] border border-fuchsia-500/30 text-fuchsia-100 text-[11px] rounded-md px-1.5 py-0.5 disabled:opacity-50 [&>option]:bg-[#0A1222] max-w-[150px]"
        >
          {stores.length === 0 ? (
            <option value={me.store_uuid ?? ""}>{me.store_name ?? "로딩…"}</option>
          ) : (
            stores.map((s) => (
              <option key={s.store_uuid} value={s.store_uuid}>
                {s.floor_no === 3 ? "☕ 카페" : s.floor_no ? `${s.floor_no}층` : "?"}{" · "}
                {s.store_name}
              </option>
            ))
          )}
        </select>
      </label>

      {/* 2026-05-03 R-Operator-Mode: 권한 view 4-button 그룹.
          이전엔 owner/page.tsx 본문 패널에 있던 [사장 / 실장 / 스태프 / 원래]
          버튼을 상단 sticky bar 로 이동. 어느 페이지에서든 1탭으로 모드 전환.
          dropdown 보다 4 버튼이 훨씬 더 명확 — 운영자가 자주 쓰는 기능. */}
      <span className="text-[10px] text-fuchsia-300/80 shrink-0 ml-auto">권한</span>
      <div className="flex items-center gap-1 shrink-0">
        {[
          { v: "owner",   label: "사장" },
          { v: "manager", label: "실장" },
          { v: "staff",   label: "스태프" },
        ].map((r) => {
          const active = currentRole === r.v
          return (
            <button
              key={r.v}
              type="button"
              onClick={() => { if (!active) switchRole(r.v) }}
              disabled={busy}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                active
                  ? "bg-fuchsia-500/40 border-fuchsia-400/60 text-fuchsia-50"
                  : "bg-white/[0.05] border-white/10 text-slate-300 hover:bg-fuchsia-500/15 hover:border-fuchsia-500/30 hover:text-fuchsia-100"
              } disabled:opacity-50`}
            >
              {r.label}
            </button>
          )
        })}
        {isOverridden && (
          <button
            onClick={clearOverride}
            disabled={busy}
            className="px-2 py-0.5 rounded text-[11px] font-semibold border bg-fuchsia-500/30 hover:bg-fuchsia-500/40 text-fuchsia-50 border-fuchsia-400/40 disabled:opacity-50"
            title="override 해제 — 본인 권한으로"
          >
            {busy ? "..." : "원래"}
          </button>
        )}
      </div>
    </div>
  )
}
