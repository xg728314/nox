"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import CustomerCreditTabs from "./CustomerCreditTabs"

type Customer = {
  id: string
  name: string
  phone: string | null
  memo: string | null
  tags: string[]
  visit_count: number
  total_amount: number
  last_visit: string | null
}

const TAG_OPTIONS = ["단골", "큰손", "퍼블릭선호", "주의"] as const

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [scope, setScope] = useState<"all" | "mine">("all")
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: "", phone: "", memo: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function fetchCustomers(q?: string) {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (q) qs.set("q", q)
      qs.set("scope", scope)
      const res = await apiFetch(`/api/customers?${qs}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const d = await res.json()
        setCustomers(d.customers ?? [])
      }
    } catch { setError("로딩 실패") }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  useEffect(() => {
    const t = setTimeout(() => fetchCustomers(search), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function handleAdd() {
    if (!addForm.name.trim()) return
    setSaving(true); setError("")
    try {
      const res = await apiFetch("/api/customers", {
        method: "POST",
        body: JSON.stringify(addForm),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.message || "등록 실패"); return }
      setShowAdd(false)
      setAddForm({ name: "", phone: "", memo: "" })
      fetchCustomers(search)
    } catch { setError("요청 오류") }
    finally { setSaving(false) }
  }

  function fmtWon(v: number) { return v.toLocaleString() + "원" }
  function fmtDate(s: string | null) {
    if (!s) return "-"
    return new Date(s).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/counter")}
              className="text-slate-400 hover:text-white text-lg"
            >&larr;</button>
            <span className="text-base font-bold">고객·외상</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
              {customers.length}명
            </span>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
          >
            + 신규
          </button>
        </div>

        {/* 2026-04-25: 고객·외상 통합 탭 네비게이션. */}
        <CustomerCreditTabs active="customers" />

        {/* Search + scope */}
        <div className="px-4 pb-3 flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름 또는 전화번호 검색"
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/40"
          />
          <div className="flex gap-0.5">
            {(["all", "mine"] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${scope === s ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "bg-white/5 text-slate-400 border border-white/[0.06]"}`}
              >
                {s === "all" ? "전체" : "내 고객"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="mx-4 mt-2 p-2 rounded-lg bg-red-500/10 text-red-400 text-xs">{error}</div>}

      {/* Add form */}
      {showAdd && (
        <div className="mx-4 mt-3 p-4 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
          <input
            value={addForm.name}
            onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
            placeholder="이름 *"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <input
            value={addForm.phone}
            onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="전화번호"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <input
            value={addForm.memo}
            onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))}
            placeholder="메모"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2 rounded-lg bg-white/5 text-slate-400 text-sm">취소</button>
            <button onClick={handleAdd} disabled={saving || !addForm.name.trim()} className="flex-1 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 text-sm font-medium disabled:opacity-40">
              {saving ? "저장 중..." : "등록"}
            </button>
          </div>
        </div>
      )}

      {/* Customer list */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="text-center py-12 text-slate-500 text-sm animate-pulse">로딩 중...</div>
        ) : customers.length === 0 ? (
          <div className="text-center py-12 text-slate-600 text-sm">
            {search ? "검색 결과가 없습니다." : "등록된 고객이 없습니다."}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {customers.map(c => (
              <div
                key={c.id}
                onClick={() => router.push(`/customers/${c.id}`)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] cursor-pointer transition-all group"
              >
                {/* Name + phone */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-white truncate">{c.name}</span>
                    {c.tags && c.tags.length > 0 && c.tags.map(tag => (
                      <span key={tag} className={`text-[8px] px-1 py-px rounded font-bold ${
                        tag === "단골" ? "bg-emerald-500/20 text-emerald-400" :
                        tag === "큰손" ? "bg-amber-500/20 text-amber-400" :
                        tag === "주의" ? "bg-red-500/20 text-red-400" :
                        "bg-cyan-500/20 text-cyan-400"
                      }`}>{tag}</span>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {c.phone || "번호없음"}
                    {c.memo && <span className="ml-2 text-slate-600">· {c.memo}</span>}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400 font-medium">{c.visit_count}회</div>
                    <div className="text-[10px] text-slate-600">{fmtDate(c.last_visit)}</div>
                  </div>
                  <span className="text-[11px] text-slate-400 font-semibold min-w-[4.5rem] text-right">{fmtWon(c.total_amount)}</span>
                  <span className="text-[10px] text-slate-600 group-hover:text-cyan-400 transition-colors">&#x276F;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
