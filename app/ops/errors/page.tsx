"use client"

/**
 * 시스템 에러 모니터링 대시보드 (owner 전용).
 *
 * 2026-04-25 (초기): captureException() 으로 수집된 예외를 시간순 표시.
 *
 * 2026-04-28 (R-system-errors-resolve):
 *   - (tag, error_name, error_message) 기준 fingerprint 그룹 표시.
 *   - 최근 발생(last_seen) 기준 "🔴 활성" / "🟡 잠잠" / "⚪ 해결됨" 상태.
 *   - 그룹 단위 ✓ 해결됨 처리 (POST /api/telemetry/errors/resolve).
 *   - 일괄 정리 ("전부 해결됨") + active/resolved 필터.
 *   - 해결된 행은 cron(system-errors-cleanup) 이 30일 후 자동 삭제.
 */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Group = {
  fingerprint: string
  tag: string | null
  error_name: string | null
  error_message: string | null
  count: number
  first_seen: string
  last_seen: string
  last_url: string | null
  sample_id: string
  sample_stack: string | null
  sample_extra: Record<string, unknown> | null
  sample_actor_role: string | null
  sample_user_agent: string | null
  sample_digest: string | null
  resolved_at: string | null
}

type TagRow = { tag: string; count: number }

type StatusFilter = "active" | "resolved" | "all"

function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  const diff = now - t
  if (diff < 0) return "방금"
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일 전`
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })
}

function statusBadge(g: Group, now: number): { label: string; cls: string } {
  if (g.resolved_at) {
    return { label: "⚪ 해결됨", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" }
  }
  const lastMs = new Date(g.last_seen).getTime()
  const ageMs = now - lastMs
  if (ageMs < 60 * 60 * 1000) {
    return { label: "🔴 활성", cls: "bg-red-500/15 text-red-300 border-red-500/30" }
  }
  if (ageMs < 6 * 60 * 60 * 1000) {
    return { label: "🟡 잠잠", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" }
  }
  return { label: "⏳ 곧 자동해결", cls: "bg-slate-500/15 text-slate-400 border-slate-500/20" }
}

export default function ErrorsPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [tagSummary, setTagSummary] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState(24)
  const [status, setStatus] = useState<StatusFilter>("active")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(iv)
  }, [])

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/telemetry/errors?hours=${hours}&status=${status}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("조회 실패")
        return
      }
      const data = await res.json()
      setGroups(data.groups ?? [])
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
  }, [hours, status])

  async function dismissGroup(g: Group) {
    setBusy(g.fingerprint)
    try {
      const res = await apiFetch("/api/telemetry/errors/resolve", {
        method: "POST",
        body: JSON.stringify({
          tag: g.tag,
          error_name: g.error_name,
          error_message: g.error_message,
        }),
      })
      if (!res.ok) {
        setError("해결 처리 실패")
        return
      }
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(null)
    }
  }

  async function dismissAll() {
    if (!confirm(`이 화면의 활성 에러 ${groups.length}건을 모두 해결됨으로 처리할까요?`)) return
    setBusy("__ALL__")
    try {
      const res = await apiFetch("/api/telemetry/errors/resolve", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) {
        setError("일괄 해결 처리 실패")
        return
      }
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(null)
    }
  }

  const totalCount = useMemo(
    () => groups.reduce((s, g) => s + g.count, 0),
    [groups],
  )

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

      {/* 필터 */}
      <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-white/10">
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
        <span className="w-2" />
        {[
          { label: "활성", value: "active" as const },
          { label: "해결됨", value: "resolved" as const },
          { label: "전체", value: "all" as const },
        ].map(s => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`px-3 py-1.5 rounded-full text-xs border ${
              status === s.value
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40"
                : "bg-white/[0.03] text-slate-400 border-white/10"
            }`}
          >{s.label}</button>
        ))}
        {status === "active" && groups.length > 0 && (
          <button
            onClick={dismissAll}
            disabled={busy !== null}
            className="ml-auto text-xs px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 disabled:opacity-50 hover:bg-amber-500/25"
            title="이 매장의 모든 활성 에러를 해결됨으로 처리"
          >
            {busy === "__ALL__" ? "처리 중..." : "전부 해결됨으로 표시"}
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* 태그 요약 */}
      {tagSummary.length > 0 && (
        <div className="px-4 py-3 border-b border-white/10">
          <div className="text-xs text-slate-400 mb-2">
            태그별 (그룹 {groups.length}개 · 발생 총 {totalCount}건)
          </div>
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

      {!loading && groups.length === 0 && (
        <div className="text-center py-12 text-emerald-400/60 text-sm">
          {status === "resolved" ? "해결된 에러가 없습니다." : "✅ 이 기간에 활성 에러가 없습니다."}
        </div>
      )}

      <div className="px-4 py-3 space-y-2">
        {groups.map(g => {
          const badge = statusBadge(g, now)
          const isExpanded = expanded === g.fingerprint
          return (
            <div
              key={g.fingerprint}
              className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                g.resolved_at
                  ? "border-slate-500/15 bg-slate-500/[0.03] hover:bg-slate-500/[0.06]"
                  : "border-red-500/15 bg-red-500/[0.04] hover:bg-red-500/[0.07]"
              }`}
              onClick={() => setExpanded(isExpanded ? null : g.fingerprint)}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${badge.cls}`}>
                    {badge.label}
                  </span>
                  {g.tag && (
                    <code className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 whitespace-nowrap">
                      {g.tag}
                    </code>
                  )}
                  <span className="text-sm font-medium text-red-200 truncate">{g.error_name || "Error"}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 whitespace-nowrap">
                    × {g.count}
                  </span>
                </div>
                {!g.resolved_at && (
                  <button
                    onClick={(e) => { e.stopPropagation(); dismissGroup(g) }}
                    disabled={busy !== null}
                    className="text-[11px] px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 whitespace-nowrap"
                    title="이 묶음 전체를 해결됨으로 표시"
                  >
                    {busy === g.fingerprint ? "처리 중..." : "✓ 해결됨"}
                  </button>
                )}
              </div>

              {g.error_message && (
                <div className="text-xs text-slate-300 break-all leading-relaxed">{g.error_message}</div>
              )}

              <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1.5 flex-wrap">
                <span>처음: {relativeTime(g.first_seen, now)}</span>
                <span className="text-slate-600">·</span>
                <span>최근: <b className={g.resolved_at ? "text-slate-400" : "text-red-300"}>
                  {relativeTime(g.last_seen, now)}
                </b></span>
                {g.last_url && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="truncate max-w-[40%]">📍 {g.last_url.replace(/^https?:\/\/[^/]+/, "")}</span>
                  </>
                )}
                {g.sample_actor_role && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span>({g.sample_actor_role})</span>
                  </>
                )}
                {g.resolved_at && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span>해결: {relativeTime(g.resolved_at, now)}</span>
                  </>
                )}
              </div>

              {isExpanded && g.sample_stack && (
                <pre className="mt-3 text-[10px] bg-black/40 p-2 rounded border border-white/5 overflow-x-auto text-slate-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {g.sample_stack}
                </pre>
              )}
              {isExpanded && g.sample_extra && (
                <pre className="mt-2 text-[10px] bg-black/40 p-2 rounded border border-white/5 overflow-x-auto text-cyan-300/80 whitespace-pre-wrap">
                  {JSON.stringify(g.sample_extra, null, 2)}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
