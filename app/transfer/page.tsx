"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Transfer = {
  id: string
  hostess_membership_id: string
  from_store_uuid: string
  to_store_uuid: string
  business_day_id: string | null
  status: string
  from_store_approved_by: string | null
  from_store_approved_at: string | null
  to_store_approved_by: string | null
  to_store_approved_at: string | null
  reason: string | null
  created_at: string
  updated_at: string
}

type StatusFilter = "all" | "pending" | "approved" | "cancelled"

export default function TransferPage() {
  const router = useRouter()
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [storeUuid, setStoreUuid] = useState("")

  useEffect(() => {
    fetchList("all")
  }, [])

  async function fetchList(status?: StatusFilter) {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (status && status !== "all") params.set("status", status)
      const res = await apiFetch(`/api/transfer/list?${params.toString()}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setTransfers(data.transfers ?? [])
        if (data.store_uuid) setStoreUuid(data.store_uuid)
      } else {
        setError("이적 목록을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  function handleFilter(f: StatusFilter) {
    setStatusFilter(f)
    fetchList(f)
  }

  async function handleApprove(transferId: string) {
    setActionLoading(transferId)
    setError("")
    try {
      const res = await apiFetch("/api/transfer/approve", {
        method: "POST",
        body: JSON.stringify({ transfer_id: transferId }),
      })
      if (res.ok) {
        fetchList(statusFilter)
      } else {
        const data = await res.json()
        setError(data.message || "승인 처리에 실패했습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancel(transferId: string) {
    setActionLoading(transferId)
    setError("")
    try {
      const res = await apiFetch("/api/transfer/cancel", {
        method: "POST",
        body: JSON.stringify({ transfer_id: transferId }),
      })
      if (res.ok) {
        fetchList(statusFilter)
      } else {
        const data = await res.json()
        setError(data.message || "취소 처리에 실패했습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setActionLoading(null)
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case "pending": return "대기"
      case "approved": return "승인"
      case "cancelled": return "취소"
      default: return status
    }
  }

  function getStatusStyle(status: string) {
    switch (status) {
      case "pending": return "bg-amber-500/20 text-amber-300"
      case "approved": return "bg-emerald-500/20 text-emerald-300"
      case "cancelled": return "bg-red-500/20 text-red-400"
      default: return "bg-white/10 text-slate-500"
    }
  }

  function getDirection(t: Transfer): "outgoing" | "incoming" | "unknown" {
    if (t.from_store_uuid === storeUuid) return "outgoing"
    if (t.to_store_uuid === storeUuid) return "incoming"
    return "unknown"
  }

  function getApprovalInfo(t: Transfer) {
    const fromApproved = !!t.from_store_approved_by
    const toApproved = !!t.to_store_approved_by
    return { fromApproved, toApproved }
  }

  if (loading && transfers.length === 0) {
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
          <span className="font-semibold">이적 관리</span>
          <div className="w-16" />
        </div>

        {/* 상태 필터 탭 */}
        <div className="flex border-b border-white/10">
          {([["all", "전체"], ["pending", "대기"], ["approved", "승인"], ["cancelled", "취소"]] as [StatusFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleFilter(key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                statusFilter === key ? "text-cyan-400 border-b-2 border-cyan-400" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 로딩 */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-cyan-400 text-sm">로딩 중...</div>
          </div>
        )}

        {/* 목록 */}
        {!loading && (
          <div className="px-4 py-4 space-y-3">
            {transfers.length === 0 && !error && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <div className="text-3xl mb-3">🔄</div>
                <p className="text-slate-500 text-sm">이적 요청이 없습니다.</p>
              </div>
            )}

            {transfers.map((t) => {
              const dir = getDirection(t)
              const approval = getApprovalInfo(t)
              const isPending = t.status === "pending"
              const isActioning = actionLoading === t.id

              return (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                  {/* 상단: 방향 + 상태 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        dir === "outgoing" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"
                      }`}>
                        {dir === "outgoing" ? "보내기" : "받기"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusStyle(t.status)}`}>
                        {getStatusLabel(t.status)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(t.created_at).toLocaleDateString("ko-KR")}
                    </div>
                  </div>

                  {/* 스태프 + store 정보 */}
                  <div className="space-y-1">
                    <div className="text-xs text-slate-400">
                      스태프: <span className="text-slate-200 font-mono">{t.hostess_membership_id.slice(0, 8)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">출발:</span>
                      <span className={`font-mono ${t.from_store_uuid === storeUuid ? "text-cyan-300" : "text-slate-300"}`}>
                        {t.from_store_uuid.slice(0, 8)}
                        {t.from_store_uuid === storeUuid && " (내 업소)"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">도착:</span>
                      <span className={`font-mono ${t.to_store_uuid === storeUuid ? "text-cyan-300" : "text-slate-300"}`}>
                        {t.to_store_uuid.slice(0, 8)}
                        {t.to_store_uuid === storeUuid && " (내 업소)"}
                      </span>
                    </div>
                  </div>

                  {/* 사유 */}
                  {t.reason && (
                    <div className="text-xs text-slate-400">
                      사유: <span className="text-slate-300">{t.reason}</span>
                    </div>
                  )}

                  {/* 승인 현황 */}
                  {isPending && (
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${approval.fromApproved ? "bg-emerald-400" : "bg-slate-600"}`} />
                        <span className="text-slate-400">출발 업소</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${approval.toApproved ? "bg-emerald-400" : "bg-slate-600"}`} />
                        <span className="text-slate-400">도착 업소</span>
                      </div>
                    </div>
                  )}

                  {/* 액션 버튼 (pending만) */}
                  {isPending && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleApprove(t.id)}
                        disabled={isActioning}
                        className="flex-1 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {isActioning ? "처리 중..." : "승인"}
                      </button>
                      <button
                        onClick={() => handleCancel(t.id)}
                        disabled={isActioning}
                        className="flex-1 h-10 rounded-xl bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        {isActioning ? "처리 중..." : "취소"}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
