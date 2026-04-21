"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type CustomerDetail = {
  id: string
  name: string
  phone: string | null
  memo: string | null
  tags: string[]
}

type Stats = {
  total_visits: number
  total_amount: number
  avg_amount: number
  last_visit: string | null
}

type Visit = {
  session_id: string
  room_label: string
  started_at: string
  ended_at: string | null
  status: string
  manager_name: string | null
  party_size: number
  gross_total: number
  participant_count: number
  receipt_snapshots: { id: string; receipt_type: string; created_at: string }[]
}

const TAG_OPTIONS = ["단골", "큰손", "퍼블릭선호", "주의"] as const

export default function CustomerDetailPage({ params }: { params: Promise<{ customer_id: string }> }) {
  const { customer_id } = use(params)
  const router = useRouter()
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: "", phone: "", memo: "", tags: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function fetchDetail() {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/customers/${customer_id}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const d = await res.json()
        setCustomer(d.customer)
        setStats(d.stats)
        setVisits(d.visits ?? [])
        setEditForm({
          name: d.customer.name,
          phone: d.customer.phone || "",
          memo: d.customer.memo || "",
          tags: d.customer.tags ?? [],
        })
      }
    } catch { setError("로딩 실패") }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer_id])

  async function handleSave() {
    setSaving(true); setError("")
    try {
      const res = await apiFetch(`/api/customers/${customer_id}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      })
      if (res.ok) {
        setEditing(false)
        fetchDetail()
      } else {
        const d = await res.json()
        setError(d.message || "저장 실패")
      }
    } catch { setError("요청 오류") }
    finally { setSaving(false) }
  }

  function toggleTag(tag: string) {
    setEditForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
    }))
  }

  function fmtWon(v: number) { return v.toLocaleString() + "원" }
  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
  }
  function fmtTime(s: string) {
    return new Date(s).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex items-center justify-center">
        <div className="text-cyan-400 text-sm animate-pulse">로딩 중...</div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex flex-col items-center justify-center gap-3">
        <p className="text-red-400 text-sm">고객을 찾을 수 없습니다.</p>
        <button onClick={() => router.push("/customers")} className="text-cyan-400 text-sm underline">돌아가기</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/customers")} className="text-slate-400 hover:text-white text-lg">&larr;</button>
            <span className="text-base font-bold">{customer.name}</span>
            {customer.tags?.map(tag => (
              <span key={tag} className={`text-[8px] px-1 py-px rounded font-bold ${
                tag === "단골" ? "bg-emerald-500/20 text-emerald-400" :
                tag === "큰손" ? "bg-amber-500/20 text-amber-400" :
                tag === "주의" ? "bg-red-500/20 text-red-400" :
                "bg-cyan-500/20 text-cyan-400"
              }`}>{tag}</span>
            ))}
          </div>
          <button
            onClick={() => setEditing(v => !v)}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
          >
            {editing ? "취소" : "수정"}
          </button>
        </div>
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded-lg bg-red-500/10 text-red-400 text-xs">{error}</div>}

      {/* Info + edit */}
      <div className="px-4 py-4 border-b border-white/[0.06]">
        {editing ? (
          <div className="space-y-2">
            <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="이름"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white outline-none" />
            <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="전화번호"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white outline-none" />
            <input value={editForm.memo} onChange={e => setEditForm(f => ({ ...f, memo: e.target.value }))} placeholder="메모"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white outline-none" />
            {/* Tags */}
            <div className="flex gap-1.5 pt-1">
              {TAG_OPTIONS.map(tag => (
                <button key={tag} onClick={() => toggleTag(tag)}
                  className={`text-[10px] px-2 py-1 rounded-lg border ${editForm.tags.includes(tag)
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                    : "bg-white/5 text-slate-400 border-white/[0.06]"}`}
                >{tag}</button>
              ))}
            </div>
            <button onClick={handleSave} disabled={saving} className="w-full py-2 mt-1 rounded-lg bg-cyan-500/20 text-cyan-300 text-sm font-medium disabled:opacity-40">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="text-slate-500 w-12">전화</span>
              <span>{customer.phone || "-"}</span>
            </div>
            {customer.memo && (
              <div className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-slate-500 w-12">메모</span>
                <span>{customer.memo}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats (CUSTOMER-6) */}
      {stats && (
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "총 방문", value: `${stats.total_visits}회`, cls: "text-cyan-300" },
              { label: "총 금액", value: fmtWon(stats.total_amount), cls: "text-emerald-300" },
              { label: "평균", value: fmtWon(stats.avg_amount), cls: "text-amber-300" },
              { label: "최근", value: stats.last_visit ? fmtDate(stats.last_visit) : "-", cls: "text-slate-300" },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2 text-center">
                <div className="text-[9px] text-slate-500">{s.label}</div>
                <div className={`text-[12px] font-bold mt-0.5 ${s.cls}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visit history (CUSTOMER-3) */}
      <div className="px-4 py-3">
        <div className="text-[11px] text-slate-500 font-semibold mb-2">방문 이력</div>
        {visits.length === 0 ? (
          <div className="text-center py-8 text-slate-600 text-sm">방문 기록이 없습니다.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visits.map(v => (
              <div key={v.session_id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
                {/* Row 1: date + room + amount */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-white">{fmtDate(v.started_at)}</span>
                    <span className="text-[11px] text-slate-400">{v.room_label}</span>
                    <span className={`text-[9px] px-1 py-px rounded font-semibold ${
                      v.status === "closed" ? "bg-slate-500/20 text-slate-400" : "bg-emerald-500/20 text-emerald-400"
                    }`}>{v.status === "closed" ? "완료" : "진행"}</span>
                  </div>
                  <span className="text-[12px] font-semibold text-slate-300">{fmtWon(v.gross_total)}</span>
                </div>
                {/* Row 2: manager + party + time */}
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  {v.manager_name && <span className="text-purple-300/70">{v.manager_name}</span>}
                  {v.party_size > 0 && <span>{v.party_size}인</span>}
                  <span>스태프 {v.participant_count}명</span>
                  <span>{fmtTime(v.started_at)}{v.ended_at ? ` ~ ${fmtTime(v.ended_at)}` : ""}</span>
                </div>
                {/* Row 3: receipt snapshots (CUSTOMER-5) */}
                {v.receipt_snapshots.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {v.receipt_snapshots.map(rs => (
                      <button
                        key={rs.id}
                        onClick={() => router.push(`/customers/${customer_id}/receipt/${rs.id}`)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border ${
                          rs.receipt_type === "final"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        } hover:opacity-80`}
                      >
                        {rs.receipt_type === "final" ? "최종" : "중간"} {fmtTime(rs.created_at)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
