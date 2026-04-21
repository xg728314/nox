"use client"

/**
 * StoreListSheet — 층 선택 후 매장 리스트 시트.
 *
 * - 실 API 호출: GET /api/monitor/stores?floor=N
 * - 4 상태: loading / error(403 포함) / empty / list
 * - mock 없음.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type StoreEntry = {
  store_uuid: string
  store_name: string
  is_mine: boolean
  active_sessions: number
  total_rooms: number
}

type Props = {
  open: boolean
  floor: number | null
  onClose: () => void
  onSelectStore: (storeUuid: string) => void
}

export default function StoreListSheet({ open, floor, onClose, onSelectStore }: Props) {
  const [stores, setStores] = useState<StoreEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || floor == null) return
    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null); setStores([])
      try {
        const r = await apiFetch(`/api/monitor/stores?floor=${floor}`)
        if (cancelled) return
        if (r.status === 403) {
          setError("403 — 이 층을 볼 권한이 없습니다.")
          return
        }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setError(`${r.status} — ${b.message ?? b.error ?? "load failed"}`)
          return
        }
        const json = await r.json() as { floor: number; stores: StoreEntry[] }
        if (!cancelled) setStores(json.stores ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "network error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, floor])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true" aria-label={`${floor}층 매장 선택`}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        className="relative w-full bg-[#0b0e1c] border-t border-white/[0.08] rounded-t-2xl max-h-[70vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="text-[14px] font-bold text-slate-100">{floor}층 매장</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="닫기">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && <div className="text-slate-500 text-[12px] py-6 text-center">매장 목록 로드 중…</div>}
          {error && (
            <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">
              ⚠ {error}
            </div>
          )}
          {!loading && !error && stores.length === 0 && (
            <div className="text-slate-500 text-[12px] py-6 text-center">
              {floor}층에 활성 매장이 없습니다.
            </div>
          )}
          {!loading && !error && stores.length > 0 && (
            <ul className="space-y-1">
              {stores.map(s => (
                <li key={s.store_uuid}>
                  <button
                    onClick={() => onSelectStore(s.store_uuid)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      s.is_mine
                        ? "bg-cyan-500/10 border-cyan-500/30 text-slate-100"
                        : "bg-white/[0.03] border-white/10 text-slate-200 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{s.store_name}</span>
                      {s.is_mine && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200">내 가게</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      방 {s.total_rooms} · 활성 세션 {s.active_sessions}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
