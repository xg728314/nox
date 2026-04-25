"use client"

/**
 * 이슈 트리아지 페이지 (owner/manager).
 *
 * 2026-04-25: 실장들이 제출한 버그/정산불일치/BLE오류 리포트 조회 + 상태 변경.
 * owner: 전체 이슈 / 상태 변경 가능.
 * manager: 본인이 제출한 것만 조회 (상태 변경 불가).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

type Issue = {
  id: string
  category: string
  severity: string
  status: string
  title: string
  description: string | null
  reporter_name: string | null
  reporter_role: string | null
  related_session_id: string | null
  related_room_uuid: string | null
  page_url: string | null
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
}

const CATEGORY_LABEL: Record<string, string> = {
  settlement_mismatch: "정산 불일치",
  ble_location: "BLE 위치",
  ui_bug: "UI 버그",
  data_incorrect: "데이터 오류",
  feature_request: "기능 제안",
  other: "기타",
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/40",
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-cyan-500/20 text-cyan-200",
  in_review: "bg-purple-500/20 text-purple-200",
  resolved: "bg-emerald-500/20 text-emerald-200",
  dismissed: "bg-slate-500/20 text-slate-400",
  duplicate: "bg-slate-500/20 text-slate-400",
}

const STATUS_LABEL: Record<string, string> = {
  open: "신규",
  in_review: "검토 중",
  resolved: "해결됨",
  dismissed: "반려",
  duplicate: "중복",
}

export default function IssuesPage() {
  const router = useRouter()
  const profile = useCurrentProfile()
  const role = profile?.role ?? ""
  const isOwner = role === "owner"

  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("open,in_review")
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : ""
      const res = await apiFetch(`/api/issues${qs}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "조회 실패")
        return
      }
      const data = await res.json()
      setIssues(data.issues ?? [])
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function patchStatus(id: string, nextStatus: string, note?: string) {
    const res = await apiFetch(`/api/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus, resolution_note: note }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.message || "상태 변경 실패")
      return
    }
    load()
  }

  async function markResolved(id: string) {
    const note = window.prompt("해결 메모 (선택):", "")
    patchStatus(id, "resolved", note ?? undefined)
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
          <span className="font-semibold">🐞 이슈 트리아지</span>
          <div className="text-xs text-slate-500">{issues.length}건</div>
        </div>

        {/* 필터 */}
        <div className="px-4 py-3 flex gap-1.5 border-b border-white/10 overflow-x-auto">
          {[
            { label: "미해결", value: "open,in_review" },
            { label: "신규만", value: "open" },
            { label: "검토 중", value: "in_review" },
            { label: "해결됨", value: "resolved" },
            { label: "반려/중복", value: "dismissed,duplicate" },
            { label: "전체", value: "" },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs border ${
                statusFilter === f.value
                  ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40"
                  : "bg-white/[0.03] text-slate-400 border-white/10"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8 text-slate-500 text-sm">로딩 중...</div>
        )}

        {!loading && issues.length === 0 && (
          <div className="text-center py-12 text-slate-500 text-sm">
            이 필터에 해당하는 이슈가 없습니다.
          </div>
        )}

        <div className="px-4 py-3 space-y-2">
          {issues.map(it => (
            <div key={it.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${SEVERITY_STYLE[it.severity] ?? SEVERITY_STYLE.medium}`}>
                    {it.severity.toUpperCase()}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_STYLE[it.status] ?? STATUS_STYLE.open}`}>
                    {STATUS_LABEL[it.status] ?? it.status}
                  </span>
                  <span className="text-[11px] text-slate-500">{CATEGORY_LABEL[it.category] ?? it.category}</span>
                </div>
                <span className="text-[10px] text-slate-600 whitespace-nowrap">
                  {new Date(it.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="text-sm font-semibold text-slate-100 mb-1">{it.title}</div>

              {it.description && (
                <div className="text-xs text-slate-400 whitespace-pre-wrap mb-2 leading-relaxed">
                  {it.description}
                </div>
              )}

              <div className="flex items-center flex-wrap gap-2 text-[10px] text-slate-500 mb-2">
                <span>
                  제출: <b className="text-slate-300">{it.reporter_name || "-"}</b>
                  {it.reporter_role && <span className="ml-1">({it.reporter_role})</span>}
                </span>
                {it.page_url && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-xs">📍 {it.page_url.replace(/^https?:\/\/[^/]+/, "")}</span>
                  </>
                )}
                {it.related_session_id && (
                  <>
                    <span>·</span>
                    <span>세션: <code className="text-slate-400">{it.related_session_id.slice(0, 8)}</code></span>
                  </>
                )}
              </div>

              {it.resolution_note && (
                <div className="text-[11px] text-emerald-300/80 bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1 mb-2">
                  ✓ {it.resolution_note}
                </div>
              )}

              {isOwner && it.status !== "resolved" && it.status !== "dismissed" && it.status !== "duplicate" && (
                <div className="flex gap-1.5 pt-2 border-t border-white/[0.05]">
                  {it.status === "open" && (
                    <button
                      onClick={() => patchStatus(it.id, "in_review")}
                      className="flex-1 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 text-[11px] border border-purple-500/25 hover:bg-purple-500/25"
                    >검토 시작</button>
                  )}
                  <button
                    onClick={() => markResolved(it.id)}
                    className="flex-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] border border-emerald-500/25 hover:bg-emerald-500/25"
                  >해결됨</button>
                  <button
                    onClick={() => patchStatus(it.id, "dismissed", "재현 불가 또는 의도된 동작")}
                    className="px-3 py-1.5 rounded-lg bg-slate-500/15 text-slate-400 text-[11px] border border-slate-500/25 hover:bg-slate-500/25"
                  >반려</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
