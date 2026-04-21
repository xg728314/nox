"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Header = {
  id: string
  to_store_uuid: string
  to_store_name: string
  total_amount: number | string
  prepaid_amount: number | string
  remaining_amount: number | string
  status: string
  memo: string | null
  created_at: string
}
type DetailItem = {
  id: string
  manager_membership_id: string | null
  manager_name: string | null
  amount: number | string
  paid_amount: number | string
  remaining_amount: number | string
  status: string
}
type Detail = { header: Header; items: DetailItem[] }
type StoreOption = { id: string; store_name: string; store_code: string | null; floor: number | null }
type ManagerOption = { membership_id: string; profile_id: string; name: string; store_uuid: string }

const n = (v: number | string) => {
  const x = typeof v === "number" ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}
const won = (v: number | string) => n(v).toLocaleString("ko-KR") + "원"

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    open: "bg-slate-500/15 text-slate-300",
    partial: "bg-amber-500/15 text-amber-300",
    completed: "bg-emerald-500/15 text-emerald-300",
    cancelled: "bg-rose-500/15 text-rose-300",
  }
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${map[s] ?? "bg-slate-500/15 text-slate-300"}`}>{s}</span>
}

export default function CrossStorePayoutsPage() {
  const router = useRouter()
  const [list, setList] = useState<Header[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [flash, setFlash] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // create form state
  const [toStore, setToStore] = useState("")
  const [total, setTotal] = useState("")
  const [memo, setMemo] = useState("")
  const [formItems, setFormItems] = useState<Array<{ manager_membership_id: string; amount: string }>>([{ manager_membership_id: "", amount: "" }])
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([])
  const [managerLoading, setManagerLoading] = useState(false)

  // list filters
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "partial" | "completed">("all")
  const [searchStore, setSearchStore] = useState("")

  // payout state
  const [payoutItemId, setPayoutItemId] = useState<string | null>(null)
  const [payoutAmount, setPayoutAmount] = useState("")
  const [payoutMemo, setPayoutMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    ;(async () => {
      const meRes = await apiFetch("/api/auth/me")
      if (meRes.status === 401 || meRes.status === 403) { router.push("/login"); return }
      const me = await meRes.json().catch(() => ({}))
      // STEP-013A: owner-only page.
      if (me.role !== "owner") { router.push("/payouts"); return }
      await load()
    })()
  }, [])

  async function load() {
    setLoading(true); setError("")
    try {
      const res = await apiFetch("/api/cross-store")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (!res.ok) { setError("데이터를 불러올 수 없습니다."); return }
      const data = await res.json()
      setList(data.settlements ?? [])
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  // STEP-015: load store picker options on first expand of the create form.
  async function loadStoreOptions() {
    if (storeOptions.length > 0) return
    try {
      const res = await apiFetch("/api/stores")
      if (!res.ok) return
      const data = await res.json()
      setStoreOptions(data.stores ?? [])
    } catch {
      // silent — form shows empty picker
    }
  }

  // STEP-015: refresh manager picker whenever the selected store changes.
  async function loadManagerOptions(storeUuid: string) {
    setManagerOptions([])
    if (!storeUuid) return
    setManagerLoading(true)
    try {
      const res = await apiFetch(`/api/store-managers?store_uuid=${encodeURIComponent(storeUuid)}`)
      if (!res.ok) return
      const data = await res.json()
      setManagerOptions(data.managers ?? [])
    } catch {
      // silent
    } finally {
      setManagerLoading(false)
    }
  }

  function openCreateForm() {
    setShowCreate(true)
    loadStoreOptions()
  }

  function onStoreChange(next: string) {
    setToStore(next)
    // clear already-selected managers since manager_membership_id is scoped per store
    setFormItems(arr => arr.map(it => ({ ...it, manager_membership_id: "" })))
    if (next) loadManagerOptions(next)
    else setManagerOptions([])
  }

  async function openDetail(id: string) {
    setSelectedId(id); setDetail(null); setPayoutItemId(null)
    const res = await apiFetch(`/api/cross-store/${id}`)
    if (res.ok) setDetail(await res.json())
  }

  async function submitCreate() {
    if (submitting) return
    setFlash("")
    if (!toStore) { setFlash("상대 매장을 선택하세요."); return }
    const totalNum = Number(total)
    if (!Number.isFinite(totalNum) || totalNum <= 0) { setFlash("총액을 확인하세요."); return }
    const items = formItems
      .filter(it => it.manager_membership_id || it.amount)
      .map(it => ({ manager_membership_id: it.manager_membership_id.trim(), amount: Number(it.amount) }))
    if (items.some(it => !it.manager_membership_id)) { setFlash("모든 행에 실장을 선택하세요."); return }
    if (items.some(it => !Number.isFinite(it.amount) || it.amount <= 0)) { setFlash("모든 금액을 확인하세요."); return }
    const sum = items.reduce((a, b) => a + (Number.isFinite(b.amount) ? b.amount : 0), 0)
    if (Math.abs(sum - totalNum) > 0.0001) { setFlash(`합계 ${sum.toLocaleString()} ≠ 총액 ${totalNum.toLocaleString()}`); return }
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/cross-store", {
        method: "POST",
        body: JSON.stringify({
          to_store_uuid: toStore.trim(),
          total_amount: totalNum,
          memo: memo || null,
          items,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setFlash(data?.message || data?.error || "생성 실패"); return }
      setFlash("생성 완료")
      setShowCreate(false); setToStore(""); setTotal(""); setMemo(""); setFormItems([{ manager_membership_id: "", amount: "" }])
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPayout() {
    if (submitting || !detail || !payoutItemId) return
    const amt = Number(payoutAmount)
    if (!Number.isFinite(amt) || amt <= 0) { setFlash("금액을 확인하세요."); return }
    setSubmitting(true); setFlash("")
    try {
      const res = await apiFetch("/api/cross-store/payout", {
        method: "POST",
        body: JSON.stringify({
          cross_store_settlement_id: detail.header.id,
          item_id: payoutItemId,
          amount: amt,
          memo: payoutMemo || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setFlash(data?.message || data?.error || "지급 실패"); return }
      setFlash("지급 완료")
      setPayoutItemId(null); setPayoutAmount(""); setPayoutMemo("")
      await Promise.all([load(), openDetail(detail.header.id)])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#030814] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
        <div>
          <button onClick={() => router.push("/payouts")} className="text-xs text-slate-400 hover:text-slate-200">← 정산 현황</button>
          <h1 className="mt-1 text-lg font-semibold">교차정산</h1>
        </div>
        <button onClick={() => (showCreate ? setShowCreate(false) : openCreateForm())} className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
          {showCreate ? "닫기" : "+ 생성"}
        </button>
      </header>

      <div className="p-5 space-y-4">
        {flash && <p className="text-sm text-emerald-300">{flash}</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        {showCreate && (
          <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 space-y-2">
            <p className="text-xs text-slate-400">새 교차정산</p>
            <label className="block text-[11px] text-slate-500">상대 매장</label>
            <select
              value={toStore}
              onChange={e => onStoreChange(e.target.value)}
              className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs"
            >
              <option value="">매장 선택…</option>
              {storeOptions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.store_name}{s.floor != null ? ` (${s.floor}F)` : ""}
                </option>
              ))}
            </select>
            <label className="block text-[11px] text-slate-500">총액</label>
            <input value={total} onChange={e => setTotal(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="예: 1500000" className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm" />
            {total && <p className="text-[11px] text-slate-500">{Number(total).toLocaleString("ko-KR")}원</p>}
            <label className="block text-[11px] text-slate-500">메모 (선택, ≤500자)</label>
            <input value={memo} maxLength={500} onChange={e => setMemo(e.target.value)} placeholder="메모" className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs" />
            <p className="mt-2 text-[11px] text-slate-500">실장별 분배{managerLoading ? " (실장 목록 불러오는 중…)" : ""}</p>
            {formItems.map((it, idx) => (
              <div key={idx} className="flex gap-2">
                <select
                  value={it.manager_membership_id}
                  onChange={e => setFormItems(arr => arr.map((x, i) => i === idx ? { ...x, manager_membership_id: e.target.value } : x))}
                  disabled={!toStore || managerOptions.length === 0}
                  className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] disabled:opacity-50"
                >
                  <option value="">{toStore ? "실장 선택…" : "먼저 매장 선택"}</option>
                  {managerOptions.map(m => (
                    <option key={m.membership_id} value={m.membership_id}>{m.name}</option>
                  ))}
                </select>
                <input
                  value={it.amount}
                  onChange={e => setFormItems(arr => arr.map((x, i) => i === idx ? { ...x, amount: e.target.value.replace(/[^0-9]/g, "") } : x))}
                  inputMode="numeric"
                  placeholder="금액"
                  className="w-28 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs"
                />
              </div>
            ))}
            <button onClick={() => setFormItems(arr => [...arr, { manager_membership_id: "", amount: "" }])} className="text-[11px] text-slate-400">+ 행 추가</button>
            <button disabled={submitting} onClick={submitCreate} className="mt-2 w-full rounded bg-emerald-500/80 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50">생성</button>
          </section>
        )}

        <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-wrap gap-2 items-center text-xs">
          <div className="flex gap-1">
            {(["all", "open", "partial", "completed"] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2 py-1 ${statusFilter === s ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "border border-white/10 text-slate-400"}`}
              >
                {s === "all" ? "전체" : s}
              </button>
            ))}
          </div>
          <input
            value={searchStore}
            onChange={e => setSearchStore(e.target.value)}
            placeholder="매장명 검색"
            className="flex-1 min-w-[120px] rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
          />
        </section>

        {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
        {!loading && list.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
            <p className="text-sm text-slate-400">교차정산 내역이 없습니다.</p>
            <button onClick={openCreateForm} className="mt-2 text-xs text-emerald-300">+ 첫 교차정산 생성</button>
          </div>
        )}

        {list
          .filter(h => statusFilter === "all" || h.status === statusFilter)
          .filter(h => !searchStore || h.to_store_name.toLowerCase().includes(searchStore.toLowerCase()))
          .map(h => (
          <section key={h.id} className="rounded-lg border border-white/10 bg-white/[0.04]">
            <button onClick={() => openDetail(h.id)} className="w-full p-4 text-left">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{h.to_store_name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{new Date(h.created_at).toLocaleString("ko-KR")}</p>
                </div>
                <StatusBadge s={h.status} />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-slate-400">총 {won(h.total_amount)}</span>
                <span className="text-emerald-300">지급 {won(h.prepaid_amount)}</span>
                <span className="text-amber-300">잔액 {won(h.remaining_amount)}</span>
              </div>
            </button>

            {selectedId === h.id && detail && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {detail.items.map(it => (
                  <div key={it.id} className="rounded border border-white/5 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm">{it.manager_name ?? "-"}</p>
                      <StatusBadge s={it.status} />
                    </div>
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="text-slate-400">{won(it.amount)}</span>
                      <span className="text-emerald-300">지급 {won(it.paid_amount)}</span>
                      <span className="text-amber-300">잔액 {won(it.remaining_amount)}</span>
                    </div>

                    {n(it.remaining_amount) > 0 && (
                      payoutItemId === it.id ? (
                        <div className="mt-3 space-y-2">
                          <input type="number" value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} placeholder="금액" className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm" />
                          <input value={payoutMemo} onChange={e => setPayoutMemo(e.target.value)} placeholder="메모 (선택)" className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs" />
                          <div className="flex gap-2">
                            <button disabled={submitting} onClick={submitPayout} className="flex-1 rounded bg-emerald-500/80 px-3 py-1.5 text-xs font-medium text-slate-900 disabled:opacity-50">확인</button>
                            <button onClick={() => { setPayoutItemId(null); setPayoutAmount(""); setPayoutMemo("") }} className="flex-1 rounded border border-white/10 px-3 py-1.5 text-xs">취소</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setPayoutItemId(it.id); setPayoutAmount(String(n(it.remaining_amount))); setPayoutMemo("") }} className="mt-2 w-full rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">부분 지급</button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
