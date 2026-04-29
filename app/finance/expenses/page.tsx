"use client"

/**
 * /finance/expenses — 일반 일별 지출 등록 + 목록.
 *
 * 카테고리: 공과금/과일/급여/팁/교통/추가월세/기타
 *   ※ 매장의 정기 월세/공과금/잡비 고정비는 store_settings.monthly_*
 *      에 별도 등록하며, 본 화면은 일별 변동 지출만.
 *
 * 권한: owner only.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtWon } from "@/lib/format"

type ExpenseRow = {
  id: string
  business_date: string
  category: string
  amount_won: number
  description: string | null
  memo: string | null
  receipt_url: string | null
  status: string
  created_at: string
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "utility", label: "공과금" },
  { value: "fruit", label: "과일" },
  { value: "salary", label: "급여" },
  { value: "tip", label: "팁/봉사료" },
  { value: "transport", label: "교통" },
  { value: "rent_extra", label: "추가 월세" },
  { value: "other", label: "기타" },
]

function todayKstDate(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}

export default function ExpensesPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterCategory, setFilterCategory] = useState("")

  const [fmDate, setFmDate] = useState(todayKstDate())
  const [fmCategory, setFmCategory] = useState("utility")
  const [fmAmount, setFmAmount] = useState("")
  const [fmDesc, setFmDesc] = useState("")
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
      const url = `/api/finance/expenses${params.toString() ? `?${params.toString()}` : ""}`
      const res = await apiFetch(url)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("지출 내역을 불러올 수 없습니다.")
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
    const amount = Number(fmAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("금액을 정확히 입력하세요.")
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/finance/expenses", {
        method: "POST",
        body: JSON.stringify({
          business_date: fmDate,
          category: fmCategory,
          amount_won: amount,
          description: fmDesc.trim() || undefined,
          memo: fmMemo.trim() || undefined,
        }),
      })
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.message || "지출 등록에 실패했습니다.")
        return
      }
      setFmAmount("")
      setFmDesc("")
      setFmMemo("")
      fetchList()
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("이 지출을 삭제하시겠습니까?")) return
    try {
      const res = await apiFetch(`/api/finance/expenses/${id}`, { method: "DELETE" })
      if (res.ok) fetchList()
      else setError("삭제 실패")
    } catch {
      setError("서버 오류")
    }
  }

  const totalSum = rows.reduce((s, r) => s + Number(r.amount_won ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-cyan-300">지출 등록</h1>
            <p className="text-xs text-slate-500 mt-1">일별 변동 지출. 정기 고정비는 운영 설정 → 매장 설정.</p>
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
          <h2 className="text-sm text-slate-400 mb-4">신규 지출</h2>
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
            <Field label="금액 (원)">
              <input
                type="number"
                value={fmAmount}
                onChange={(e) => setFmAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
            <Field label="설명" col="md:col-span-3">
              <input
                value={fmDesc}
                onChange={(e) => setFmDesc(e.target.value)}
                placeholder="예: 4월 한전 전기료"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
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
            <div className="text-sm text-slate-400">지출 내역 ({rows.length}건)</div>
            <div className="text-sm text-amber-300 tabular-nums">합계 {fmtWon(totalSum)}</div>
          </div>
          {loading ? (
            <div className="text-center text-cyan-400 text-sm py-8">로딩 중...</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8">지출 내역이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-white/5">
                  <th className="px-4 py-2 text-left">영업일</th>
                  <th className="px-4 py-2 text-left">분류</th>
                  <th className="px-4 py-2 text-left">설명</th>
                  <th className="px-4 py-2 text-right">금액</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-slate-400">{r.business_date}</td>
                    <td className="px-4 py-2">{CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category}</td>
                    <td className="px-4 py-2">{r.description ?? ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-300">{fmtWon(r.amount_won)}</td>
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
