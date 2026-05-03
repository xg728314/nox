"use client"

/**
 * CafeManageContext — /cafe/manage/* 전체에 공유되는 bootstrap 상태.
 *
 * 한 번 fetch 해서 home 페이지 + CafeShell sidebar/alert 모두 사용 → 중복 fetch 제거.
 * 10초 polling 1회만 발화.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type CafeBootstrap = {
  profile: { store_uuid: string; store_name: string | null; floor: number | null }
  inbox: {
    pending: number; preparing: number; delivering: number; credited: number
    today_count: number; today_gross: number
  }
  credits_unpaid: { count: number; total: number }
  chat_unread: number
  chat_rooms: Array<{
    id: string; name: string | null; type: string;
    last_message_text: string | null; last_message_at: string | null;
    room_uuid: string | null
  }>
  low_stock: Array<{
    id: string; name: string; current_stock: number; min_stock: number; unit: string; category: string | null
  }>
  account: { bank_name: string | null; account_number: string | null; account_holder: string | null; is_active: boolean } | null
}

type Ctx = {
  data: CafeBootstrap | null
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const CafeManageCtx = createContext<Ctx | null>(null)

export function CafeManageProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CafeBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/cafe/manage/bootstrap")
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.message || "bootstrap 로드 실패")
        return
      }
      const d = await r.json()
      setData(d as CafeBootstrap)
      setError("")
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <CafeManageCtx.Provider value={{ data, loading, error, refresh }}>
      {children}
    </CafeManageCtx.Provider>
  )
}

export function useCafeManage(): Ctx {
  const v = useContext(CafeManageCtx)
  if (!v) throw new Error("useCafeManage must be inside CafeManageProvider")
  return v
}
