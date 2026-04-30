"use client"

/**
 * /admin/learn — 학습 corpus (learning_signals) 대시보드.
 *
 * R-Learn-Corpus (2026-04-30):
 *   "사람이 raw → corrected 로 수정한 모든 쌍을 누적. 적용 안 함, 학습용."
 *
 * 본 페이지는 super_admin only. 운영자가 누적된 corpus 의 패턴을 확인하고
 *   - 어느 영역(reconcile.staff.* / reconcile.rooms.* 등) 에서 가장 많이
 *     수정이 일어나는지
 *   - 매장별 데이터 분포
 *   - 최근 어떤 raw → corrected 가 들어왔는지 (PII 제외)
 * 를 본 후 CSV export 로 외부 fine-tune / 분석에 사용.
 *
 * PII row 는 raw_value/corrected_value 가 hash 로 표시됨 (h_xxxx). 평문 복원 X.
 *
 * Note: 데이터 5000 row 까지 client aggregate. 그 이상이면 별도 라운드에서
 *       PG aggregate RPC 로 전환.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfileState } from "@/lib/auth/useCurrentProfile"

type Row = {
  id: string
  store_uuid: string | null
  store_name: string | null
  signal_type: string
  raw_value: string | null
  corrected_value: string | null
  pii_masked: boolean
  source_model: string | null
  created_at: string
}

type StatsResponse = {
  total: number
  capped: boolean
  by_type: Array<{ signal_type: string; count: number }>
  by_store: Array<{ store_uuid: string | null; store_name: string | null; count: number }>
  recent: Row[]
}

export default function AdminLearnPage() {
  const router = useRouter()
  const profileState = useCurrentProfileState()
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [storeFilter, setStoreFilter] = useState<string>("")

  const isSuperAdmin = profileState.profile?.is_super_admin === true

  useEffect(() => {
    if (profileState.loading) return
    if (profileState.needsLogin) {
      router.push("/login")
      return
    }
    if (!isSuperAdmin) {
      // super_admin 아니면 거부
      return
    }
    void load(storeFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileState.loading, profileState.needsLogin, isSuperAdmin, storeFilter])

  async function load(target: string) {
    setLoading(true)
    setError("")
    try {
      const qs = target ? `?target_store_uuid=${encodeURIComponent(target)}` : ""
      const res = await apiFetch(`/api/learn/stats${qs}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "조회 실패")
        setData(null)
        return
      }
      setData(d as StatsResponse)
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  function downloadCsv(opts: { signal_type_prefix?: string; include_pii?: boolean }) {
    const params = new URLSearchParams()
    params.set("format", "csv")
    params.set("limit", "5000")
    if (storeFilter) params.set("target_store_uuid", storeFilter)
    if (opts.signal_type_prefix) params.set("signal_type_prefix", opts.signal_type_prefix)
    if (opts.include_pii) params.set("include_pii", "true")
    const url = `/api/learn/export?${params.toString()}`
    // 브라우저에 navigation — apiFetch 가 Bearer 헤더 붙이므로 직접 fetch + blob 다운로드
    void (async () => {
      try {
        const res = await apiFetch(url)
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          alert(d.message || d.error || "다운로드 실패")
          return
        }
        const blob = await res.blob()
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = `learning_signals_${Date.now()}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      } catch {
        alert("네트워크 오류")
      }
    })()
  }

  if (profileState.loading) {
    return <div className="min-h-screen bg-[#030814] text-slate-500 flex items-center justify-center text-sm">로딩 중...</div>
  }
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-[#030814] text-slate-300 flex flex-col items-center justify-center gap-3 text-sm px-6">
        <div className="text-red-400 font-semibold">접근 권한 없음</div>
        <div className="text-slate-400 text-xs text-center">
          학습 corpus 는 super_admin 만 열람할 수 있습니다.
        </div>
        <button onClick={() => router.push("/owner")} className="mt-2 px-4 py-2 rounded-lg border border-white/10 text-cyan-300 text-xs">
          ← 돌아가기
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">← 사장</button>
        <span className="font-semibold">🧠 학습 Corpus</span>
        <button onClick={() => load(storeFilter)} className="text-xs text-slate-400 hover:text-white">새로고침</button>
      </div>

      <div className="px-4 py-4 max-w-5xl mx-auto space-y-4">
        {/* 정책 안내 */}
        <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4 text-xs text-fuchsia-100/90 leading-relaxed">
          <div className="font-semibold text-fuchsia-200 mb-1">정책: 학습만 하고 적용은 안 함</div>
          모든 NOX 영역에서 사람이 수정한 raw → corrected 쌍을 누적합니다. 본 데이터는
          runtime 에 자동 적용되지 않으며, 외부 모델 fine-tune / 패턴 분석용 corpus 로만
          사용됩니다. PII 가 포함된 row (이름/전화 등) 는 SHA-256 hash 로 마스킹되어
          저장됩니다.
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        )}

        {/* 매장 필터 */}
        {data && data.by_store.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">매장 필터:</span>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-slate-200"
            >
              <option value="">전체</option>
              {data.by_store
                .filter((s) => s.store_uuid)
                .map((s) => (
                  <option key={s.store_uuid} value={s.store_uuid ?? ""}>
                    {s.store_name ?? s.store_uuid?.slice(0, 8)} ({s.count})
                  </option>
                ))}
            </select>
          </div>
        )}

        {loading && <div className="text-xs text-slate-500">로딩 중...</div>}

        {data && (
          <>
            {/* 핵심 지표 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">총 시그널</div>
                <div className="text-2xl font-bold text-cyan-300 mt-1">{data.total.toLocaleString()}</div>
                {data.capped && <div className="text-[10px] text-amber-300 mt-1">5000 cap</div>}
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">시그널 종류</div>
                <div className="text-2xl font-bold text-emerald-300 mt-1">{data.by_type.length}</div>
              </div>
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">기여 매장</div>
                <div className="text-2xl font-bold text-fuchsia-300 mt-1">
                  {data.by_store.filter((s) => s.store_uuid).length}
                </div>
              </div>
            </div>

            {/* CSV 다운로드 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-300 mb-2">📥 CSV 추출</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => downloadCsv({})}
                  className="px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                >
                  전체 (PII 제외)
                </button>
                <button
                  onClick={() => downloadCsv({ signal_type_prefix: "reconcile." })}
                  className="px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                >
                  종이장부만
                </button>
                <button
                  onClick={() => downloadCsv({ signal_type_prefix: "reconcile.staff." })}
                  className="px-3 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
                >
                  스태프 시트만
                </button>
                <button
                  onClick={() => downloadCsv({ signal_type_prefix: "reconcile.rooms." })}
                  className="px-3 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
                >
                  매장 시트만
                </button>
                <button
                  onClick={() => downloadCsv({ include_pii: true })}
                  className="col-span-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                >
                  전체 + PII 포함 (hash 형태로)
                </button>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                * 매장 필터 적용된 상태로 다운로드됩니다. 최대 5000 row.
              </div>
            </div>

            {/* signal_type 분포 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs font-semibold text-slate-300 mb-3">📊 시그널 타입 분포</div>
              {data.by_type.length === 0 ? (
                <div className="text-xs text-slate-500">데이터 없음</div>
              ) : (
                <div className="space-y-1.5">
                  {data.by_type.slice(0, 20).map((t) => {
                    const pct = data.total > 0 ? (t.count / data.total) * 100 : 0
                    return (
                      <div key={t.signal_type} className="flex items-center gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-slate-200 truncate">{t.signal_type}</div>
                          <div className="h-1 mt-1 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                        <div className="font-mono text-cyan-300 w-12 text-right">{t.count}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* by_store */}
            {data.by_store.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold text-slate-300 mb-3">🏪 매장별 기여도</div>
                <div className="space-y-1 text-xs">
                  {data.by_store.map((s) => (
                    <div key={s.store_uuid ?? "none"} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                      <div className="text-slate-200">{s.store_name ?? <span className="text-slate-500 italic">(매장 미지정)</span>}</div>
                      <div className="font-mono text-fuchsia-300">{s.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 최근 20건 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs font-semibold text-slate-300 mb-3">🕘 최근 20건</div>
              {data.recent.length === 0 ? (
                <div className="text-xs text-slate-500">데이터 없음</div>
              ) : (
                <div className="space-y-2">
                  {data.recent.map((r) => (
                    <div key={r.id} className="border border-white/5 rounded-lg p-2 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-cyan-300">{r.signal_type}</span>
                        <span className="text-[10px] text-slate-500">
                          {r.store_name ? `${r.store_name} · ` : ""}
                          {new Date(r.created_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-slate-500">raw</div>
                          <div className={`font-mono ${r.pii_masked ? "text-amber-300" : "text-slate-300"} break-all`}>
                            {r.raw_value ?? <span className="text-slate-600">(null)</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">→ corrected</div>
                          <div className={`font-mono ${r.pii_masked ? "text-amber-300" : "text-emerald-300"} break-all`}>
                            {r.corrected_value ?? <span className="text-slate-600">(null)</span>}
                          </div>
                        </div>
                      </div>
                      {r.pii_masked && (
                        <div className="text-[10px] text-amber-400/70 mt-1">⚠ PII hash (raw 복원 불가)</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
