"use client"

/**
 * 시스템 에러 모니터링 대시보드 (owner 전용).
 *
 * 2026-04-25: captureException() 이 수집한 예외를 시간순/태그별로 표시.
 * 최근 24시간 → 72시간 → 7일 필터.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type ErrRow = {
  id: string
  actor_role: string | null
  tag: string | null
  error_name: string | null
  error_message: string | null
  stack: string | null
  digest: string | null
  url: string | null
  user_agent: string | null
  created_at: string
  extra: Record<string, unknown> | null
}

type TagRow = { tag: string; count: number }

export default function ErrorsPage() {
  const router = useRouter()
  const [errors, setErrors] = useState<ErrRow[]>([])
  const [tagSummary, setTagSummary] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState(24)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/telemetry/errors?hours=${hours}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("조회 실패")
        return
      }
      const data = await res.json()
      setErrors(data.errors ?? [])
      setTagSummary(data.tag_summary ?? [])
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours])

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">⚠️ 시스템 에러 모니터</span>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 disabled:opacity-50"
        >새로고침</button>
      </div>

      {/* 시간 범위 */}
      <div className="px-4 py-3 flex gap-1.5 border-b border-white/10">
        {[
          { label: "24시간", value: 24 },
          { label: "72시간", value: 72 },
          { label: "7일", value: 168 },
        ].map(h => (
          <button
            key={h.value}
            onClick={() => setHours(h.value)}
            className={`px-3 py-1.5 rounded-full text-xs border ${
              hours === h.value
                ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40"
                : "bg-white/[0.03] text-slate-400 border-white/10"
            }`}
          >{h.label}</button>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* 태그 요약 */}
      {tagSummary.length > 0 && (
        <div className="px-4 py-3 border-b border-white/10">
          <div className="text-xs text-slate-400 mb-2">태그별 (총 {errors.length}건)</div>
          <div className="flex flex-wrap gap-1.5">
            {tagSummary.map(t => (
              <span key={t.tag} className="text-[11px] px-2 py-1 rounded bg-white/[0.04] border border-white/10">
                <code className="text-slate-300">{t.tag}</code>
                <b className="ml-1.5 text-amber-300">{t.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-slate-500 text-sm">로딩 중...</div>
      )}

      {!loading && errors.length === 0 && (
        <div className="text-center py-12 text-emerald-400/60 text-sm">
          ✅ 이 기간에 수집된 에러가 없습니다.
        </div>
      )}

      <div className="px-4 py-3 space-y-2">
        {errors.map(e => (
          <div
            key={e.id}
            className="rounded-xl border border-red-500/10 bg-red-500/[0.03] p-3 cursor-pointer hover:bg-red-500/[0.06]"
            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {e.tag && <code className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 whitespace-nowrap">{e.tag}</code>}
                <span className="text-sm font-medium text-red-300 truncate">{e.error_name || "Error"}</span>
              </div>
              <span className="text-[10px] text-slate-500 whitespace-nowrap">
                {new Date(e.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            {e.error_message && (
              <div className="text-xs text-slate-300 break-all leading-relaxed">{e.error_message}</div>
            )}
            <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
              {e.actor_role && <span>({e.actor_role})</span>}
              {e.url && <span className="truncate">📍 {e.url.replace(/^https?:\/\/[^/]+/, "")}</span>}
              {e.digest && <span>digest: <code>{e.digest.slice(0, 12)}</code></span>}
            </div>

            {expandedId === e.id && e.stack && (
              <pre className="mt-3 text-[10px] bg-black/40 p-2 rounded border border-white/5 overflow-x-auto text-slate-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {e.stack}
              </pre>
            )}
            {expandedId === e.id && e.extra && (
              <pre className="mt-2 text-[10px] bg-black/40 p-2 rounded border border-white/5 overflow-x-auto text-cyan-300/80 whitespace-pre-wrap">
                {JSON.stringify(e.extra, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
