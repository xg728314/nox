"use client"
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useMe } from "../_hooks/useMobileData"

/**
 * super_admin 전용 매장 전환 bar — /m 앱 상단.
 *
 * 문제:
 *   - 데스크탑용 StoreContextBar 는 layout.tsx 최상단에 있지만
 *     PhoneFrame (h-100dvh + overflow-hidden) 이 뷰포트를 다 차지해서 안 보임.
 *   - /m 페이지에서 super_admin 이 매장 전환할 방법이 없음.
 *
 * 이 컴포넌트:
 *   - is_super_admin === true 일 때만 렌더
 *   - PhoneFrame 안 최상단에 sticky 배치
 *   - 매장 선택 dropdown → active-context PUT → 페이지 reload
 *
 * R-super-store-bar (2026-07-19).
 */
type StoreOpt = {
  store_uuid: string
  store_name: string
  floor_no: number | null
}

export function SuperAdminStoreBar() {
  const me = useMe()
  const [stores, setStores] = useState<StoreOpt[]>([])
  const [busy, setBusy] = useState(false)

  const isSuperAdmin = me.data?.is_super_admin === true

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

  if (!isSuperAdmin) return null

  async function switchStore(storeUuid: string) {
    if (!storeUuid || storeUuid === me.data?.store_uuid || busy) return
    setBusy(true)
    try {
      const res = await apiFetch("/api/auth/active-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_uuid: storeUuid }),
      })
      if (!res.ok) { setBusy(false); return }
      window.location.reload()
    } catch {
      setBusy(false)
    }
  }

  async function clearOverride() {
    if (busy) return
    setBusy(true)
    try {
      await apiFetch("/api/auth/active-context", { method: "DELETE" })
      window.location.reload()
    } catch {
      setBusy(false)
    }
  }

  const currentStoreUuid = me.data?.store_uuid ?? ""
  const currentRole = me.data?.role ?? "owner"
  const isOverridden = me.data?.role !== "owner"

  return (
    <div className="sticky top-0 z-30 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-3 py-1.5 flex items-center gap-2 text-[11px] font-bold shadow-md">
      <span className="bg-white/20 rounded-full px-2 py-0.5 text-[9px] shrink-0">
        운영자
      </span>
      <select
        value={currentStoreUuid}
        onChange={(e) => switchStore(e.target.value)}
        disabled={busy}
        className="bg-black/30 text-white rounded-lg px-2 py-1 text-[11px] font-bold outline-none border border-white/20 disabled:opacity-50 flex-1 min-w-0"
      >
        {stores.length === 0 && (
          <option value="">{me.data?.store_name ?? "매장 로딩..."}</option>
        )}
        {stores.map((s) => (
          <option key={s.store_uuid} value={s.store_uuid} className="text-black">
            {s.floor_no != null ? `${s.floor_no}층 · ` : ""}
            {s.store_name}
          </option>
        ))}
      </select>
      <span className="text-[10px] opacity-80 shrink-0">
        {currentRole === "manager" ? "실장" : currentRole === "hostess" ? "스태프" : "사장"}
      </span>
      {isOverridden && (
        <button
          type="button"
          onClick={clearOverride}
          disabled={busy}
          className="bg-white/20 hover:bg-white/30 rounded-full px-2 py-0.5 text-[9px] font-extrabold shrink-0"
        >
          원래로
        </button>
      )}
    </div>
  )
}
