"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Presence = {
  id: string
  store_uuid: string
  minor: number
  room_uuid: string | null
  membership_id: string | null
  last_event_type: string | null
  last_seen_at: string | null
  updated_at: string
  room_name: string | null
  hostess_name: string | null
}

export default function BlePage() {
  const router = useRouter()
  const [presences, setPresences] = useState<Presence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchPresence()
    const interval = setInterval(() => fetchPresence(), 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchPresence() {
    try {
      const res = await apiFetch("/api/ble/presence")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setPresences(data.presences ?? [])
        setError("")
      } else {
        setError("BLE 데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  function getTimeSince(dateStr: string | null) {
    if (!dateStr) return "—"
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return `${diff}초 전`
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    return `${Math.floor(diff / 3600)}시간 전`
  }

  function getEventLabel(type: string | null) {
    switch (type) {
      case "enter": return "입장"
      case "exit": return "퇴장"
      case "heartbeat": return "감지 중"
      default: return type || "—"
    }
  }

  function getEventStyle(type: string | null) {
    switch (type) {
      case "enter": return "bg-emerald-500/20 text-emerald-300"
      case "exit": return "bg-red-500/20 text-red-400"
      case "heartbeat": return "bg-cyan-500/20 text-cyan-300"
      default: return "bg-white/10 text-slate-400"
    }
  }

  function isOnline(lastSeen: string | null) {
    if (!lastSeen) return false
    return Date.now() - new Date(lastSeen).getTime() < 300000
  }

  const onlineCount = presences.filter((p) => isOnline(p.last_seen_at)).length

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 카운터</button>
          <div className="flex items-center gap-2">
            <span className="font-semibold">BLE 모니터링</span>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${onlineCount > 0 ? "bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.9)] animate-pulse" : "bg-slate-500"}`} />
              <span className="text-xs text-slate-400">10초 갱신</span>
            </div>
          </div>
          <div className="w-16" />
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-2 gap-3 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-400">온라인 태그</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-300">
              {onlineCount}
              <span className="text-base text-slate-400"> / {presences.length}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-400">전체 태그</div>
            <div className="mt-1 text-2xl font-semibold text-cyan-300">{presences.length}</div>
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 목록 */}
        <div className="px-4 space-y-3">
          {presences.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📡</div>
              <p className="text-slate-500 text-sm">BLE 태그 데이터가 없습니다.</p>
              <p className="text-slate-600 text-xs mt-1">게이트웨이가 작동 중인지 확인하세요.</p>
            </div>
          )}

          {presences.map((p) => {
            const online = isOnline(p.last_seen_at)
            return (
              <div key={p.id} className={`rounded-2xl border p-4 space-y-2 ${
                online ? "border-cyan-500/20 bg-cyan-500/5" : "border-white/10 bg-white/[0.04]"
              }`}>
                {/* 상단: 이름 + 상태 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      online ? "bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]" : "bg-slate-600"
                    }`} />
                    <div>
                      <span className="text-sm font-medium">
                        {p.hostess_name || `태그 #${p.minor}`}
                      </span>
                      {p.hostess_name && (
                        <span className="text-xs text-slate-500 ml-2">#{p.minor}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getEventStyle(p.last_event_type)}`}>
                    {getEventLabel(p.last_event_type)}
                  </span>
                </div>

                {/* 위치 + 시간 */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">
                      위치: <span className="text-slate-200">{p.room_name || "미지정"}</span>
                    </span>
                    {p.membership_id && (
                      <span className="text-slate-500 font-mono">{p.membership_id.slice(0, 8)}</span>
                    )}
                  </div>
                  <span className={`${online ? "text-emerald-400" : "text-slate-500"}`}>
                    {getTimeSince(p.last_seen_at)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
