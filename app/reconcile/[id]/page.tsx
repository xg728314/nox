"use client"

/**
 * /reconcile/[id] — 단일 사진 상세 + 추출/diff 뷰.
 *
 * R27: 사진 + 메타 표시 + "추출 시작" 버튼 (R28 에서 동작 연결).
 * R28~30 에서 추출 결과 / DB 비교 / 사람 확정 UI 추가.
 */

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import type { PaperExtraction } from "@/lib/reconcile/types"
import RoomsEditor from "./components/RoomsEditor"
import StaffEditor from "./components/StaffEditor"
import ImageQualityPanel from "./components/ImageQualityPanel"

type Detail = {
  snapshot: {
    id: string
    business_date: string
    sheet_kind: "rooms" | "staff" | "other"
    storage_path: string
    file_name: string | null
    status: string
    notes?: string | null
    uploaded_at: string
  }
  signed_url: string | null
  extraction: {
    id: string
    extracted_json: PaperExtraction
    vlm_model: string
    prompt_version: number
    cost_usd: number | null
    duration_ms: number | null
    unknown_tokens: string[] | null
    created_at: string
  } | null
  /** 2026-04-30: 사용자 최신 편집본. 있으면 Editor 가 이걸 우선 사용. */
  latest_edit: {
    id: string
    base_extraction_id: string | null
    edited_json: PaperExtraction
    edit_reason: string | null
    edited_by: string | null
    edited_at: string
  } | null
  diff: {
    id: string
    paper_owe_total_won: number | null
    paper_recv_total_won: number | null
    db_owe_total_won: number | null
    db_recv_total_won: number | null
    item_diffs: unknown
    match_status: string
    reviewer_notes: string | null
    computed_at: string
  } | null
}

export default function ReconcileDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [computing, setComputing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [reviewNotes, setReviewNotes] = useState("")
  // R-A v5: 매장 호스티스/매장명 후보 — RoomsEditor 의 datalist 자동완성용
  const [knownHostesses, setKnownHostesses] = useState<string[]>([])
  const [knownStores, setKnownStores] = useState<string[]>([])

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/${id}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || "조회 실패")
        return
      }
      setData(d as Detail)
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])

  // R-A v5: 매장 호스티스 + 매장명 후보 fetch (한 번만)
  useEffect(() => {
    let cancelled = false
    async function loadKnown() {
      try {
        const res = await apiFetch("/api/store/staff")
        if (!res.ok) return
        const d = await res.json().catch(() => ({}))
        if (cancelled) return
        const staff = (d.staff ?? []) as { name?: string; role?: string; store_name?: string | null }[]
        const hostessNames = Array.from(new Set(
          staff.filter(s => s.role === "hostess").map(s => (s.name ?? "").trim()).filter(Boolean),
        ))
        const storeNames = Array.from(new Set(
          staff.map(s => (s.store_name ?? "").trim()).filter(Boolean),
        ))
        setKnownHostesses(hostessNames)
        setKnownStores(storeNames)
      } catch { /* noop */ }
    }
    void loadKnown()
    return () => { cancelled = true }
  }, [])

  async function runExtraction() {
    setExtracting(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/${id}/extract`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "추출 실패")
        return
      }
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setExtracting(false)
    }
  }

  async function runDiff() {
    setComputing(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/${id}/diff`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "비교 실패")
        return
      }
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setComputing(false)
    }
  }

  async function runReview(decision: "confirm" | "reject" | "note_only") {
    setReviewing(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: reviewNotes || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "리뷰 저장 실패")
        return
      }
      setReviewNotes("")
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setReviewing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center text-sm">불러오는 중...</div>
    )
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center flex-col gap-3">
        <div>{error || "데이터 없음"}</div>
        <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
      </div>
    )
  }

  const s = data.snapshot
  const dif = data.diff
  const itemDiffs = Array.isArray(dif?.item_diffs) ? (dif!.item_diffs as Array<{
    category: string; key: string; paper_won: number; db_won: number; diff_won: number; status: string
  }>) : []

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-24">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📑 {s.business_date} · {s.sheet_kind === "rooms" ? "방별" : s.sheet_kind === "staff" ? "스태프" : "기타"}</span>
        <button
          onClick={async () => {
            const ok1 = window.confirm(
              "이 사진을 정말 삭제하시겠습니까?\n\n" +
              "✗ 삭제: 사진 / OCR 결과 / 사람 편집본\n" +
              "✓ 보존: 학습 corpus (PII 자동 hash 처리됨)"
            )
            if (!ok1) return
            const ok2 = window.confirm("되돌릴 수 없습니다. 정말 삭제하시겠습니까?")
            if (!ok2) return
            try {
              const r = await apiFetch(`/api/reconcile/${id}`, { method: "DELETE" })
              const d = await r.json().catch(() => ({}))
              if (!r.ok) {
                alert(d.message || d.error || "삭제 실패")
                return
              }
              alert("삭제 완료. 학습 데이터는 보존됨.")
              router.push("/reconcile")
            } catch {
              alert("네트워크 오류")
            }
          }}
          className="text-red-400 text-xs hover:text-red-300"
          title="사진 삭제 (학습 corpus 는 보존)"
        >🗑 삭제</button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
      )}

      <div className="px-4 py-4 space-y-4 max-w-5xl mx-auto">
        {/* 사진 */}
        {data.signed_url && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
            <img
              src={data.signed_url}
              alt="paper ledger"
              className="w-full max-h-[80vh] object-contain rounded-xl bg-black/30"
            />
          </div>
        )}

        {/* 액션 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={runExtraction}
            disabled={extracting}
            className="py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold disabled:opacity-50"
          >
            {extracting ? "추출 중..." : data.extraction ? "재추출" : "🤖 자동 추출"}
          </button>
          <button
            onClick={runDiff}
            disabled={computing || !data.extraction}
            className="py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-semibold disabled:opacity-50"
          >
            {computing ? "비교 중..." : "🔍 DB 와 비교"}
          </button>
        </div>

        {/* 2026-04-30 fix: 편집 후 새로고침 시 데이터 사라짐 보고 → API 가
            paper_ledger_edits 도 fetch 하도록 변경. UI 는 latest_edit 우선
            사용 (있으면 사용자 편집본, 없으면 AI 원본). 사용자가 보던
            편집 결과가 그대로 복원된다. */}
        {(() => {
          const editorJson = data.latest_edit?.edited_json ?? data.extraction?.extracted_json
          const baseId = data.latest_edit?.base_extraction_id ?? data.extraction?.id ?? null
          if (!editorJson) return null
          return (
            <>
              {/* R-A: AI 인식 한계 + 다음 촬영 가이드 */}
              {editorJson.image_quality && (
                <ImageQualityPanel quality={editorJson.image_quality} />
              )}

              {/* 편집본 표시 시 안내 */}
              {data.latest_edit && (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-2 text-[11px] text-emerald-200">
                  ✓ 사용자 편집본 ({new Date(data.latest_edit.edited_at).toLocaleString("ko-KR")} 저장) 표시 중.
                  {data.latest_edit.edit_reason && ` 사유: ${data.latest_edit.edit_reason}.`}
                </div>
              )}

              {/* R-B: 방별 편집 (sheet_kind=rooms) */}
              {s.sheet_kind === "rooms" && (
                <RoomsEditor
                  snapshotId={s.id}
                  extraction={editorJson}
                  baseExtractionId={baseId}
                  onSaved={async () => { await load() }}
                  knownHostesses={knownHostesses}
                  knownStores={knownStores}
                />
              )}

              {/* 스태프 편집기 (sheet_kind=staff) */}
              {s.sheet_kind === "staff" && (
                <StaffEditor
                  snapshotId={s.id}
                  extraction={editorJson}
                  baseExtractionId={baseId}
                  onSaved={async () => { await load() }}
                  knownHostesses={knownHostesses}
                  knownStores={knownStores}
                />
              )}
            </>
          )
        })()}

        {/* diff 요약 카드 */}
        {dif && (
          <DiffCard
            matchStatus={dif.match_status}
            paperOwe={dif.paper_owe_total_won ?? 0}
            paperRecv={dif.paper_recv_total_won ?? 0}
            dbOwe={dif.db_owe_total_won ?? 0}
            dbRecv={dif.db_recv_total_won ?? 0}
          />
        )}

        {/* item-level diff 표 */}
        {itemDiffs.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-sm font-semibold mb-2">항목별 비교</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10">
                    <th className="text-left py-1.5">분류</th>
                    <th className="text-left py-1.5">매장</th>
                    <th className="text-right py-1.5">종이</th>
                    <th className="text-right py-1.5">DB</th>
                    <th className="text-right py-1.5">차이</th>
                    <th className="text-center py-1.5">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {itemDiffs.map((d, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      <td className="py-1.5">{d.category === "owe" ? "줄돈" : d.category === "recv" ? "받돈" : d.category}</td>
                      <td className="py-1.5">{d.key}</td>
                      <td className="py-1.5 text-right tabular-nums">{won(d.paper_won)}</td>
                      <td className="py-1.5 text-right tabular-nums">{won(d.db_won)}</td>
                      <td className={`py-1.5 text-right tabular-nums font-semibold ${d.diff_won === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                        {d.diff_won > 0 ? "+" : ""}{won(d.diff_won)}
                      </td>
                      <td className="py-1.5 text-center">
                        {d.status === "match" ? "✓"
                        : d.status === "mismatch" ? "⚠"
                        : d.status === "paper_only" ? "📄"
                        : "💾"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* R30: 사람 확정 (리뷰) */}
        {data.extraction && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="text-sm font-semibold">사람 확정</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              사진과 DB 비교 결과를 본인이 확인 후 승인하세요. 승인된 row 는 "사람-확정 일치 증거" 로 영구 보관됩니다 (분쟁 증빙).
            </p>
            <textarea
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              placeholder="메모 (선택) — 차이가 있다면 사유"
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => runReview("confirm")}
                disabled={reviewing}
                className="py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-semibold disabled:opacity-50"
              >✅ 일치 확정</button>
              <button
                onClick={() => runReview("note_only")}
                disabled={reviewing}
                className="py-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs disabled:opacity-50"
              >메모만 저장</button>
              <button
                onClick={() => runReview("reject")}
                disabled={reviewing}
                className="py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold disabled:opacity-50"
              >⚠ 불일치 표시</button>
            </div>
            {data.snapshot.status === "reviewed" && (
              <div className="text-[11px] text-emerald-400">
                ✓ 이 사진은 사람-확정 완료. (status: reviewed)
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => router.push("/reconcile/setup")}
          className="w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-400 hover:bg-white/[0.08]"
        >
          🛠️ 매장 종이 포맷 학습 (모르는 심볼 등록)
        </button>

        {/* extraction raw + unknown_tokens */}
        {data.extraction && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">추출 결과</div>
              <div className="text-[11px] text-slate-500">
                {data.extraction.vlm_model} · v{data.extraction.prompt_version}
                {data.extraction.cost_usd ? ` · $${data.extraction.cost_usd.toFixed(4)}` : ""}
              </div>
            </div>
            {data.extraction.unknown_tokens && data.extraction.unknown_tokens.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-200">
                ⚠ 모르는 심볼: {data.extraction.unknown_tokens.join(", ")} — 매장 사장이 의미를 등록하면 다음부터 자동 인식됩니다.
              </div>
            )}
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-400">JSON 보기</summary>
              <pre className="mt-2 p-2 bg-black/40 rounded text-[10px] overflow-x-auto leading-relaxed">{JSON.stringify(data.extraction.extracted_json, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}

function won(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return `₩${n.toLocaleString()}`
}

function DiffCard({
  matchStatus, paperOwe, paperRecv, dbOwe, dbRecv,
}: {
  matchStatus: string
  paperOwe: number; paperRecv: number; dbOwe: number; dbRecv: number
}) {
  const isMatch = matchStatus === "match"
  const isMismatch = matchStatus === "mismatch"
  const cls = isMatch ? "border-emerald-500/30 bg-emerald-500/5" :
    isMismatch ? "border-red-500/30 bg-red-500/5" :
    "border-amber-500/30 bg-amber-500/5"
  const txt = isMatch ? "text-emerald-300" : isMismatch ? "text-red-300" : "text-amber-300"
  const label = isMatch ? "✅ 일치" : isMismatch ? "⚠️ 불일치" : matchStatus === "partial" ? "△ 부분 일치" : matchStatus === "no_db_data" ? "DB 데이터 없음" : "대기"

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className={`text-base font-bold ${txt}`}>{label}</div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div className="rounded-lg bg-black/30 p-2">
          <div className="text-slate-400">줄돈 (종이/DB)</div>
          <div className="mt-0.5 font-mono">₩{paperOwe.toLocaleString()} / ₩{dbOwe.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-black/30 p-2">
          <div className="text-slate-400">받돈 (종이/DB)</div>
          <div className="mt-0.5 font-mono">₩{paperRecv.toLocaleString()} / ₩{dbRecv.toLocaleString()}</div>
        </div>
      </div>
    </div>
  )
}
