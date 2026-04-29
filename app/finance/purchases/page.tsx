"use client"

/**
 * /finance/purchases — 박스 단위 매입 등록 + 목록.
 *
 * 카테고리: 양주(liquor) / 소주(soju) / 맥주(beer) / 와인(wine) / 과일(fruit) / 기타(other)
 *   ※ 양주(liquor) 는 발렌타인/조니워커 등 brand 양주, soju/beer 와는 별도 분류.
 *
 * 등록 = 발생주의 매입 시점에 즉시 변동비 인식.
 *   PnL 화면에서는 month_start ~ month_end 범위 합으로 자동 합산.
 *
 * 권한: owner only (middleware + API 가드).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtWon } from "@/lib/format"

type PurchaseRow = {
  id: string
  business_date: string
  category: string
  item_name: string
  unit_price_won: number
  qty: number
  total_won: number
  vendor: string | null
  memo: string | null
  receipt_url: string | null
  status: string
  created_by: string
  created_at: string
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "liquor", label: "양주" },
  { value: "soju", label: "소주" },
  { value: "beer", label: "맥주" },
  { value: "wine", label: "와인" },
  { value: "fruit", label: "과일" },
  { value: "other", label: "기타" },
]

function todayKstDate(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}

export default function PurchasesPage() {
  const router = useRouter()
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterCategory, setFilterCategory] = useState("")

  // 폼 state
  const [fmDate, setFmDate] = useState(todayKstDate())
  const [fmCategory, setFmCategory] = useState("liquor")
  const [fmItem, setFmItem] = useState("")
  const [fmUnit, setFmUnit] = useState("")
  const [fmQty, setFmQty] = useState("1")
  const [fmVendor, setFmVendor] = useState("")
  const [fmMemo, setFmMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchList()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchList() {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (filterFrom) params.append("from", filterFrom)
      if (filterTo) params.append("to", filterTo)
      if (filterCategory) params.append("category", filterCategory)
      const url = `/api/finance/purchases${params.toString() ? `?${params.toString()}` : ""}`
      const res = await apiFetch(url)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("매입 내역을 불러올 수 없습니다.")
        return
      }
      const data = await res.json()
      setRows(data.items ?? [])
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    setError("")
    const unit = Number(fmUnit)
    const qty = Number(fmQty)
    if (!fmItem.trim()) {
      setError("품목명을 입력하세요.")
      return
    }
    if (!Number.isFinite(unit) || unit <= 0) {
      setError("단가를 정확히 입력하세요.")
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("수량을 정확히 입력하세요.")
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/finance/purchases", {
        method: "POST",
        body: JSON.stringify({
          business_date: fmDate,
          category: fmCategory,
          item_name: fmItem.trim(),
          unit_price_won: unit,
          qty,
          vendor: fmVendor.trim() || undefined,
          memo: fmMemo.trim() || undefined,
        }),
      })
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.message || "매입 등록에 실패했습니다.")
        return
      }
      // reset 폼
      setFmItem("")
      setFmUnit("")
      setFmQty("1")
      setFmVendor("")
      setFmMemo("")
      fetchList()
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("이 매입을 삭제하시겠습니까?")) return
    try {
      const res = await apiFetch(`/api/finance/purchases/${id}`, { method: "DELETE" })
      if (res.ok) fetchList()
      else setError("삭제 실패")
    } catch {
      setError("서버 오류")
    }
  }

  const totalSum = rows.reduce((s, r) => s + Number(r.total_won ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-cyan-300">매입 등록</h1>
            <p className="text-xs text-slate-500 mt-1">박스/병 단위 매입. 발생주의로 변동비 인식.</p>
          </div>
          <button
            onClick={() => router.push("/finance")}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← 재무
          </button>
        </header>

        {/* 등록 폼 */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm text-slate-400 mb-4">신규 매입</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="영업일">
              <input
                type="date"
                value={fmDate}
                onChange={(e) => setFmDate(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="분류">
              <select
                value={fmCategory}
                onChange={(e) => setFmCategory(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="매입처">
              <input
                value={fmVendor}
                onChange={(e) => setFmVendor(e.target.value)}
                placeholder="예: ○○ 유통"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="품목명" col="md:col-span-3">
              <input
                value={fmItem}
                onChange={(e) => setFmItem(e.target.value)}
                placeholder="예: 발렌타인 17년 1박스 (12병)"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="단가 (원)">
              <input
                type="number"
                value={fmUnit}
                onChange={(e) => setFmUnit(e.target.value)}
                placeholder="0"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="수량">
              <input
                type="number"
                value={fmQty}
                onChange={(e) => setFmQty(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="합계">
              <div className="px-3 py-2 text-sm text-emerald-300 tabular-nums bg-black/30 border border-white/10 rounded-lg">
                {fmtWon(Number(fmUnit) * Number(fmQty) || 0)}
              </div>
            </Field>
            <Field label="메모" col="md:col-span-3">
              <input
                value={fmMemo}
                onChange={(e) => setFmMemo(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
          </div>
          {error && (
            <div className="mt-3 text-xs text-red-300">{error}</div>
          )}
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-4 px-5 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-sm hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {submitting ? "등록 중..." : "등록"}
          </button>
        </section>

        {/* 필터 */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex flex-wrap items-end gap-3">
          <Field label="시작일">
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="종료일">
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="분류">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="">전체</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <button
            onClick={fetchList}
            className="px-4 py-1.5 rounded-lg border border-white/10 bg-white/5 text-sm hover:bg-white/10"
          >
            조회
          </button>
        </section>

        {/* 목록 */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between border-b border-white/5">
            <div className="text-sm text-slate-400">매입 내역 ({rows.length}건)</div>
            <div className="text-sm text-emerald-300 tabular-nums">합계 {fmtWon(totalSum)}</div>
          </div>
          {loading ? (
            <div className="text-center text-cyan-400 text-sm py-8">로딩 중...</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8">매입 내역이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-white/5">
                  <th className="px-4 py-2 text-left">영업일</th>
                  <th className="px-4 py-2 text-left">분류</th>
                  <th className="px-4 py-2 text-left">품목</th>
                  <th className="px-4 py-2 text-right">단가</th>
                  <th className="px-4 py-2 text-right">수량</th>
                  <th className="px-4 py-2 text-right">합계</th>
                  <th className="px-4 py-2 text-left">매입처</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-slate-400">{r.business_date}</td>
                    <td className="px-4 py-2">{CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category}</td>
                    <td className="px-4 py-2">{r.item_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtWon(r.unit_price_won)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.qty}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-300">{fmtWon(r.total_won)}</td>
                    <td className="px-4 py-2 text-slate-400">{r.vendor ?? ""}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(r.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({ label, children, col }: { label: string; children: React.ReactNode; col?: string }) {
  return (
    <div className={col}>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
