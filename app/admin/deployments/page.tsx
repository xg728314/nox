"use client"

/**
 * /admin/deployments — 배포 이력 + 통계 (owner only).
 *
 * R-Ver Phase 2: 사용자가 사고 발생 시 "오늘 N번째 배포 이후 터졌는지" 빠르게 확인.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfileState } from "@/lib/auth/useCurrentProfile"

type DeploymentRow = {
  id: string
  revision: string
  service: string
  region: string | null
  git_sha: string | null
  git_short_sha: string | null
  git_message: string | null
  built_at: string | null
  first_seen_at: string
  build_id: string | null
}

type Resp = {
  today_count: number
  last_24h_count: number
  last_7d_count: number
  items: DeploymentRow[]
}

function formatKst(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
  } catch {
    return iso
  }
}

export default function DeploymentsPage() {
  const router = useRouter()
  const profileState = useCurrentProfileState()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const isOwner = profileState.profile?.role === "owner"

  useEffect(() => {
    if (profileState.loading) return
    if (profileState.needsLogin) { router.push("/login"); return }
    if (!profileState.profile) return
    if (profileState.profile.role !== "owner") {
      router.push(profileState.profile.role === "manager" ? "/manager" : "/me")
    }
  }, [profileState, router])

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/admin/deployments?limit=100")
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "조회 실패")
        return
      }
      setData(d as Resp)
    } catch {
      setError("네트워크 오류")
    } finally { setLoading(false) }
  }

  useEffect(() => { if (isOwner) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOwner])

  if (profileState.loading || !profileState.profile) {
    return <div className="min-h-screen bg-[#030814] text-slate-500 flex items-center justify-center text-sm">로딩 중...</div>
  }
  if (!isOwner) {
    return <div className="min-h-screen bg-[#030814] text-slate-500 flex items-center justify-center text-sm">접근 권한 없음 (owner 전용)</div>
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">← 사장 대시보드</button>
        <span className="font-semibold">📦 배포 이력</span>
        <button onClick={load} className="text-cyan-400 text-xs">새로고침</button>
      </div>

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">
        {/* 통계 카드 */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="오늘 배포" value={data?.today_count ?? 0} tone="cyan" />
          <StatCard label="24시간" value={data?.last_24h_count ?? 0} tone="emerald" />
          <StatCard label="7일" value={data?.last_7d_count ?? 0} tone="slate" />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        {loading && <div className="text-center text-slate-500 text-sm py-6">불러오는 중...</div>}

        {!loading && (data?.items ?? []).length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
            기록된 배포 없음 (첫 호출 후 자동 누적)
          </div>
        )}

        <div className="space-y-2">
          {(data?.items ?? []).map((row, idx) => (
            <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="text-slate-500">#{(data?.items.length ?? 0) - idx}</span>
                    <span className="font-mono text-cyan-300">{row.revision}</span>
                    {row.git_short_sha && <span className="font-mono text-slate-500">· {row.git_short_sha}</span>}
                  </div>
                  {row.git_message && (
                    <div className="mt-1 text-sm text-slate-200 line-clamp-2">{row.git_message}</div>
                  )}
                  <div className="mt-1 text-[11px] text-slate-500 space-x-3">
                    <span>가동 {formatKst(row.first_seen_at)}</span>
                    {row.built_at && <span>· 빌드 {formatKst(row.built_at)}</span>}
                    {row.region && <span>· {row.region}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "cyan" | "emerald" | "slate" }) {
  const cls = tone === "cyan" ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-300"
    : tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
    : "border-white/10 bg-white/[0.03] text-slate-300"
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[10px] opacity-70">{label}</div>
      <div className="text-xl font-bold mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}
