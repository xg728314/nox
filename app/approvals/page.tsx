"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type PendingMember = {
  membership_id: string
  profile_id: string
  name: string
  nickname: string | null
  phone: string | null
  role: string
  status: string
  created_at: string
}

export default function ApprovalsPage() {
  const router = useRouter()
  const [pending, setPending] = useState<PendingMember[]>([])
  const [storeName, setStoreName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    // Auth + role gate enforced by middleware.ts.
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/store/approvals")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setPending(data.pending ?? [])
        setStoreName(data.store_name ?? null)
        setError("")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(membershipId: string, action: "approve" | "reject") {
    setActionLoading(membershipId)
    try {
      const res = await apiFetch("/api/store/approvals", {
        method: "POST",
        body: JSON.stringify({ membership_id: membershipId, action }),
      })
      if (res.ok) {
        setPending((prev) => prev.filter((p) => p.membership_id !== membershipId))
      } else {
        const data = await res.json()
        setError(data.message || "처리 실패")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#030814] flex items-center justify-center"><div className="text-cyan-400 text-sm">로딩 중...</div></div>
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
          <span className="font-semibold">
            가입 승인
            {storeName && <span className="ml-2 text-xs text-cyan-300">· {storeName}</span>}
          </span>
          <button onClick={() => fetchData()} className="text-xs text-slate-400 hover:text-white">새로고침</button>
        </div>

        {error && <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        <div className="px-4 py-4">
          <div className="text-xs text-slate-400 mb-3">대기 중: {pending.length}건</div>

          {pending.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">✅</div>
              <p className="text-slate-500 text-sm">승인 대기 중인 요청이 없습니다.</p>
            </div>
          )}

          <div className="space-y-3">
            {pending.map((m) => (
              <div key={m.membership_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/20 flex items-center justify-center text-sm text-amber-300">
                    {(m.name || "?").slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {m.name || m.profile_id.slice(0, 8)}
                      {m.nickname && (
                        <span className="ml-2 text-xs text-cyan-300">@{m.nickname}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {m.role === "manager" ? "실장" : m.role === "hostess" ? "스태프" : m.role}
                      <span className="ml-2">{new Date(m.created_at).toLocaleDateString("ko-KR")}</span>
                    </div>
                    {m.phone && (
                      <div className="text-xs text-slate-400 mt-1">📞 {m.phone}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(m.membership_id, "approve")}
                    disabled={actionLoading === m.membership_id}
                    className="flex-1 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {actionLoading === m.membership_id ? "..." : "승인"}
                  </button>
                  <button
                    onClick={() => handleAction(m.membership_id, "reject")}
                    disabled={actionLoading === m.membership_id}
                    className="flex-1 h-9 rounded-xl bg-red-500/20 text-red-300 text-xs font-medium hover:bg-red-500/30 disabled:opacity-50"
                  >
                    {actionLoading === m.membership_id ? "..." : "거부"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
