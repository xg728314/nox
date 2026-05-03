"use client"

/**
 * CafeOrderButton — 룸채팅에서 호스티스가 카페 주문 시작.
 *
 * 클릭 → 카페 매장 list fetch → 1개면 자동선택 / 2개+ 면 picker → CafeOrderModal.
 * delivery.room_uuid + session_id 자동 박힘 (현재 보고 있는 룸).
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import CafeOrderModal from "./CafeOrderModal"

type CafeStore = { id: string; store_name: string; floor: number }

type Props = {
  /** 현재 보고 있는 룸 (호스티스 사용 케이스). */
  room_uuid: string
  session_id: string
  room_label?: string
  className?: string
}

export default function CafeOrderButton({ room_uuid, session_id, room_label, className }: Props) {
  const [opening, setOpening] = useState(false)
  const [stores, setStores] = useState<CafeStore[] | null>(null)
  const [picked, setPicked] = useState<CafeStore | null>(null)
  const [error, setError] = useState("")

  async function start() {
    setError(""); setOpening(true)
    try {
      const r = await apiFetch("/api/cafe/stores")
      const d = await r.json()
      if (!r.ok) { setError(d.message || "카페 목록 로드 실패"); return }
      const list = (d.stores ?? []) as CafeStore[]
      if (list.length === 0) { setError("등록된 카페가 없습니다"); return }
      if (list.length === 1) {
        setPicked(list[0])
      } else {
        setStores(list)
      }
    } finally { setOpening(false) }
  }

  return (
    <>
      <button
        onClick={start}
        disabled={opening}
        className={
          className ??
          "px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs font-semibold hover:bg-amber-500/20 disabled:opacity-50"
        }
      >☕ {opening ? "..." : "주문"}</button>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[201] p-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* 카페 picker (2개 이상일 때) */}
      {stores && !picked && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#0a0c14] border border-cyan-500/30 rounded-xl p-4 w-full max-w-sm space-y-2">
            <div className="text-sm font-semibold text-white">카페 선택</div>
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => setPicked(s)}
                className="w-full text-left p-2.5 rounded-lg border border-white/15 hover:border-cyan-500 hover:bg-cyan-500/10 text-sm text-white"
              >{s.floor}F · {s.store_name}</button>
            ))}
            <button onClick={() => setStores(null)} className="w-full py-2 text-xs text-slate-400">취소</button>
          </div>
        </div>
      )}

      {picked && (
        <CafeOrderModal
          cafeStoreUuid={picked.id}
          cafeStoreName={picked.store_name}
          delivery={{ mode: "room", room_uuid, session_id, room_label }}
          onClose={() => { setPicked(null); setStores(null) }}
        />
      )}
    </>
  )
}
