"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type SessionDetail = {
  session_id: string
  participant_status: string
  session_status: string
}

export default function SessionDetailPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.session_id as string

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!sessionId) { setError("session_id가 없습니다."); setLoading(false); return }
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch(`/api/me/sessions/${sessionId}`)

      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }

      if (res.status === 404) {
        setNotFound(true)
        return
      }

      if (res.ok) {
        const data = await res.json()
        const s = data.session
        if (s) {
          setSession({
            session_id: s.session_id ?? "",
            participant_status: s.participant_status ?? "",
            session_status: s.session_status ?? "",
          })
        } else {
          setNotFound(true)
        }
      } else {
        setError("데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

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
          <button onClick={() => router.push("/me")} className="text-cyan-400 text-sm">← 대시보드</button>
          <span className="font-semibold">세션 상세</span>
          <div className="w-16" />
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 404 */}
        {notFound && (
          <div className="px-4 py-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">🔍</div>
              <p className="text-slate-400 text-sm">세션을 찾을 수 없습니다.</p>
              <button
                onClick={() => router.push("/me")}
                className="mt-4 px-4 py-2 rounded-xl bg-white/10 text-sm text-slate-300 hover:bg-white/15"
              >
                대시보드로 돌아가기
              </button>
            </div>
          </div>
        )}

        {/* 세션 상세 */}
        {session && !notFound && (
          <div className="px-4 py-4 space-y-4">
            {/* 세션 ID */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-slate-400">세션 ID</div>
              <div className="mt-1 text-sm font-mono text-slate-200">{session.session_id}</div>
            </div>

            {/* 참여 상태 */}
            <div className={`rounded-2xl border p-4 ${
              session.participant_status === "active"
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-white/10 bg-white/[0.04]"
            }`}>
              <div className="text-xs text-slate-400">참여 상태</div>
              <div className="mt-2 flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  session.participant_status === "active"
                    ? "bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]"
                    : "bg-slate-500"
                }`} />
                <span className={`text-lg font-semibold ${
                  session.participant_status === "active"
                    ? "text-emerald-300"
                    : "text-slate-400"
                }`}>
                  {session.participant_status === "active" ? "참여 중" : "퇴장"}
                </span>
              </div>
            </div>

            {/* 세션 상태 */}
            <div className={`rounded-2xl border p-4 ${
              session.session_status === "active"
                ? "border-cyan-500/20 bg-cyan-500/5"
                : "border-white/10 bg-white/[0.04]"
            }`}>
              <div className="text-xs text-slate-400">세션 상태</div>
              <div className="mt-2 flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  session.session_status === "active"
                    ? "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]"
                    : "bg-slate-500"
                }`} />
                <span className={`text-lg font-semibold ${
                  session.session_status === "active"
                    ? "text-cyan-300"
                    : "text-slate-400"
                }`}>
                  {session.session_status === "active"
                    ? "진행 중"
                    : session.session_status === "closed"
                      ? "종료됨"
                      : session.session_status || "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
