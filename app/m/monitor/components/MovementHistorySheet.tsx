"use client"

/**
 * MovementHistorySheet — 24h 이동 기록 시트.
 * 실 API: GET /api/monitor/movement/[membership_id]
 * BLE 데이터 부재 시: "24시간 내 기록 없음" 안내.
 * 403: 권한 안내.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type Item = {
  at: string
  kind: "ble" | "business"
  zone: string | null
  store_uuid: string | null
  room_uuid: string | null
  event_type: string | null
  source: string | null
}

type Props = {
  open: boolean
  membershipId: string | null
  displayName: string | null
  onClose: () => void
}

export default function MovementHistorySheet({ open, membershipId, displayName, onClose }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !membershipId) return
    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null); setItems([])
      try {
        const r = await apiFetch(`/api/monitor/movement/${encodeURIComponent(membershipId)}`)
        if (cancelled) return
        if (r.status === 403) { setError("403 — 이 대상의 기록을 볼 권한이 없습니다."); return }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setError(`${r.status} — ${b.message ?? b.error ?? "failed"}`)
          return
        }
        const json = await r.json() as { items: Item[] }
        if (!cancelled) setItems(json.items ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "network error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, membershipId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="이동 기록">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        className="relative w-full bg-[#0b0e1c] border-t border-white/[0.08] rounded-t-2xl max-h-[80vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-100">이동 기록 (최근 24시간)</div>
            {displayName && <div className="text-[10px] text-slate-500 truncate">{displayName}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="닫기">×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading && <div className="text-slate-500 text-[12px] py-6 text-center">기록 로드 중…</div>}
          {error && (
            <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">⚠ {error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-slate-500 text-[12px] py-8 text-center">
              24시간 내 기록이 없습니다.
              <div className="text-[10px] mt-1">BLE 신호가 아직 연결되지 않았거나, 이 사람의 비즈니스 이벤트가 없습니다.</div>
            </div>
          )}
          {items.length > 0 && (
            <ol className="space-y-1 text-[11px]">
              {items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400 tabular-nums w-[88px]">{it.at.replace("T", " ").slice(5, 19)}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                    it.kind === "ble"
                      ? "bg-cyan-500/15 text-cyan-200 border border-cyan-500/25"
                      : "bg-violet-500/15 text-violet-200 border border-violet-500/25"
                  }`}>{it.kind}</span>
                  <span className="text-slate-300">
                    {it.event_type ?? it.zone ?? "?"}
                    {it.source === "corrected" && <span className="ml-1 text-[9px] text-amber-300">· 수정</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
