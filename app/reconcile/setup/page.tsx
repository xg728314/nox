"use client"

/**
 * /reconcile/setup — 매장별 종이장부 포맷 학습 페이지 (owner 전용).
 *
 * R30: 알 수 없는 심볼을 사장이 직접 등록. known_stores 도 관리.
 *
 * 사용 흐름:
 *   1. 매장 사진 업로드 (/reconcile) → 추출 → unknown_tokens 생성
 *   2. 이 페이지에서 unknown 마다 의미 라벨링 → DB 저장
 *   3. 다음 사진부터 자동 인식 (extract.ts 가 prompt 에 포함)
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type SymbolMeaning = {
  service_type?: string
  time_tier?: string
  needs_review?: boolean
  note?: string
}

type FormatData = {
  store_uuid: string
  format: {
    symbol_dictionary: Record<string, SymbolMeaning>
    known_stores: string[]
    notes: string | null
    format_version: number
    updated_at: string
  } | null
  defaults: {
    symbol_dictionary: Record<string, SymbolMeaning>
    known_stores: readonly string[]
  }
}

const SERVICE_TYPES = ["퍼블릭", "셔츠", "하퍼"] as const
const TIME_TIERS = ["free", "차3", "반티", "반차3", "완티", "unknown"] as const

export default function ReconcileSetupPage() {
  const router = useRouter()
  const [data, setData] = useState<FormatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")

  // 편집 state
  const [overrides, setOverrides] = useState<Record<string, SymbolMeaning>>({})
  const [newSymbol, setNewSymbol] = useState("")
  const [newSvc, setNewSvc] = useState("")
  const [newTier, setNewTier] = useState("")
  const [newNote, setNewNote] = useState("")
  const [stores, setStores] = useState<string[]>([])
  const [newStore, setNewStore] = useState("")

  async function load() {
    setLoading(true); setError("")
    try {
      const res = await apiFetch("/api/reconcile/format")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.message || "조회 실패"); return }
      setData(d as FormatData)
      setOverrides({ ...((d as FormatData).format?.symbol_dictionary ?? {}) })
      setStores([...((d as FormatData).format?.known_stores ?? [])])
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  function addSymbol() {
    const k = newSymbol.trim()
    if (!k) return
    const meaning: SymbolMeaning = {}
    if (newSvc) meaning.service_type = newSvc
    if (newTier) meaning.time_tier = newTier
    if (newNote) meaning.note = newNote
    setOverrides(prev => ({ ...prev, [k]: meaning }))
    setNewSymbol(""); setNewSvc(""); setNewTier(""); setNewNote("")
  }

  function removeSymbol(k: string) {
    setOverrides(prev => {
      const cp = { ...prev }
      delete cp[k]
      return cp
    })
  }

  function addStore() {
    const k = newStore.trim()
    if (!k) return
    if (!stores.includes(k)) setStores([...stores, k])
    setNewStore("")
  }

  function removeStore(k: string) {
    setStores(stores.filter(s => s !== k))
  }

  async function save() {
    setSaving(true); setError(""); setInfo("")
    try {
      const res = await apiFetch("/api/reconcile/format", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol_dictionary: overrides,
          known_stores: stores,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.message || d.error || "저장 실패"); return }
      setInfo("저장 완료. 다음 사진부터 자동 인식됩니다.")
      await load()
    } catch { setError("네트워크 오류") }
    finally { setSaving(false) }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center">불러오는 중...</div>
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📑 종이장부 포맷 학습</span>
        <div className="w-16" />
      </div>

      <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
        {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>}
        {info && <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">{info}</div>}

        <div className="rounded-xl bg-cyan-500/[0.04] border border-cyan-500/20 p-3 text-xs text-cyan-100/80 leading-relaxed">
          이 매장 종이장부의 약어/심볼을 등록합니다. 기본 사전(★, ㅡ, (완) 등) 은 자동 적용되며,
          여기 등록한 항목이 우선합니다. 새 사진을 자동 분석할 때 prompt 에 포함됩니다.
        </div>

        {/* 심볼 추가 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="text-sm font-semibold">새 심볼 등록</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value)}
              placeholder="심볼 (예: (잔) / 빵3)"
              className="rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            />
            <input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="메모 (선택)"
              className="rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            />
            <select
              value={newSvc}
              onChange={e => setNewSvc(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            >
              <option value="">종목 (선택안함)</option>
              {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={newTier}
              onChange={e => setNewTier(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            >
              <option value="">시간 등급 (선택안함)</option>
              {TIME_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button
            onClick={addSymbol}
            disabled={!newSymbol.trim()}
            className="w-full py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold disabled:opacity-50"
          >추가</button>
        </div>

        {/* 등록된 심볼 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <div className="text-sm font-semibold mb-2">등록된 심볼 ({Object.keys(overrides).length})</div>
          {Object.keys(overrides).length === 0 && (
            <div className="text-xs text-slate-500">등록된 심볼 없음. 기본 사전만 사용 중.</div>
          )}
          {Object.entries(overrides).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-xs py-1.5 border-b border-white/[0.03]">
              <code className="bg-black/30 px-2 py-0.5 rounded font-mono text-cyan-200">{k}</code>
              <div className="flex-1 text-slate-400">
                {v.service_type && <span className="mr-2">종목: {v.service_type}</span>}
                {v.time_tier && <span className="mr-2">등급: {v.time_tier}</span>}
                {v.note && <span className="text-slate-500">— {v.note}</span>}
              </div>
              <button onClick={() => removeSymbol(k)} className="text-red-400 hover:text-red-300">삭제</button>
            </div>
          ))}
        </div>

        {/* 협력 매장 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <div className="text-sm font-semibold mb-2">협력 매장 화이트리스트 ({stores.length})</div>
          <div className="flex gap-2">
            <input
              value={newStore}
              onChange={e => setNewStore(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addStore()}
              placeholder="가게 이름 (예: 토끼)"
              className="flex-1 rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            />
            <button
              onClick={addStore}
              disabled={!newStore.trim()}
              className="px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm disabled:opacity-50"
            >추가</button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {stores.map(s => (
              <button
                key={s}
                onClick={() => removeStore(s)}
                className="px-2 py-1 rounded-full bg-white/[0.05] border border-white/10 text-xs hover:bg-red-500/15 hover:border-red-500/30 hover:text-red-300"
                title="클릭하면 삭제"
              >
                {s} ✕
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 font-semibold disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>

        {/* 기본 사전 참고 */}
        <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <summary className="cursor-pointer text-xs text-slate-400">기본 사전 보기 (모든 매장 공통)</summary>
          <pre className="mt-2 text-[10px] text-slate-400 overflow-x-auto">{JSON.stringify(data?.defaults.symbol_dictionary, null, 2)}</pre>
        </details>
      </div>
    </div>
  )
}
