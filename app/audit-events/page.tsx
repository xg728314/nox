"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type AuditRow = {
  id: string
  actor_profile_id: string | null
  actor_name: string | null
  actor_role: string | null
  actor_type: string | null
  action: string
  entity_table: string
  entity_id: string | null
  reason: string | null
  before: unknown
  after: unknown
  created_at: string
}

type Resp = {
  page: number
  page_size: number
  total: number
  events: AuditRow[]
}

const PAGE_SIZE = 50

export default function AuditEventsPage() {
  const router = useRouter()
  const [events, setEvents] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expand, setExpand] = useState<string | null>(null)

  // Filters
  const [action, setAction] = useState("")
  const [entityTable, setEntityTable] = useState("")
  const [q, setQ] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const load = useCallback(async (p: number) => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams()
      params.set("page", String(p))
      params.set("page_size", String(PAGE_SIZE))
      if (action) params.set("action", action)
      if (entityTable) params.set("entity_table", entityTable)
      if (q) params.set("q", q)
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const res = await apiFetch(`/api/audit-events?${params.toString()}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (!res.ok) { setError("데이터를 불러올 수 없습니다."); return }
      const data: Resp = await res.json()
      setEvents(data.events ?? [])
      setTotal(data.total ?? 0)
      setPage(data.page ?? p)
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }, [action, entityTable, q, from, to, router])

  useEffect(() => {
    load(1)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="min-h-screen bg-[#030814] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/owner")} className="text-xs text-slate-400 hover:text-slate-200">← 사장</button>
          <h1 className="mt-1 text-lg font-semibold">감사 로그 (owner)</h1>
        </div>
        <button onClick={() => load(1)} className="text-xs text-slate-400 hover:text-slate-200">새로고침</button>
      </header>

      <section className="border-b border-white/10 p-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <input value={action} onChange={e => setAction(e.target.value)} placeholder="action (쉼표로 여러개)" className="rounded border border-white/10 bg-black/30 px-2 py-1.5" />
        <input value={entityTable} onChange={e => setEntityTable(e.target.value)} placeholder="entity_table" className="rounded border border-white/10 bg-black/30 px-2 py-1.5" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색 (action / reason)" className="rounded border border-white/10 bg-black/30 px-2 py-1.5" />
        <input value={from} onChange={e => setFrom(e.target.value)} placeholder="from (YYYY-MM-DD)" className="rounded border border-white/10 bg-black/30 px-2 py-1.5" />
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="to (YYYY-MM-DD)" className="rounded border border-white/10 bg-black/30 px-2 py-1.5" />
        <button onClick={() => load(1)} className="col-span-2 md:col-span-5 rounded bg-emerald-500/80 px-3 py-1.5 text-slate-900 font-medium">적용</button>
      </section>

      <div className="p-5 space-y-2">
        {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {!loading && events.length === 0 && <p className="text-sm text-slate-500">결과 없음</p>}

        {events.map(e => (
          <div key={e.id} className="rounded border border-white/10 bg-white/[0.02] p-3 text-xs">
            <button onClick={() => setExpand(expand === e.id ? null : e.id)} className="w-full text-left">
              <div className="flex justify-between">
                <span className="font-medium text-emerald-300">{e.action}</span>
                <span className="text-slate-500">{new Date(e.created_at).toLocaleString("ko-KR")}</span>
              </div>
              <div className="mt-1 flex justify-between text-slate-400">
                <span>{e.entity_table} · {e.entity_id?.slice(0, 8) ?? "—"}</span>
                <span>{e.actor_name ?? "—"} ({e.actor_role})</span>
              </div>
              {e.reason && <p className="mt-1 text-slate-500">{e.reason}</p>}
            </button>
            {expand === e.id && (
              <div className="mt-2 space-y-1 text-[11px]">
                <pre className="whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-slate-400">before: {JSON.stringify(e.before, null, 2)}</pre>
                <pre className="whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-slate-400">after: {JSON.stringify(e.after, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <button disabled={page <= 1} onClick={() => load(page - 1)} className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-40">← 이전</button>
            <span className="text-xs text-slate-500">{page} / {totalPages} · 총 {total}건</span>
            <button disabled={page >= totalPages} onClick={() => load(page + 1)} className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-40">다음 →</button>
          </div>
        )}
      </div>
    </main>
  )
}
