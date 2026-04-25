"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type SnapshotResult = {
  snapshot_id: string
  session_id: string
  room_uuid: string
  store_uuid: string
  created_at: string
}

export default function ReceiptPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState("")
  const [loading, setLoading] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<SnapshotResult | null>(null)

  useEffect(() => {
    // Middleware handles auth; just mark client-ready so children render.
    setAuthChecked(true)
  }, [])

  async function handleGenerate() {
    if (!sessionId.trim()) { setError("세션 ID를 입력하세요."); return }

    setLoading(true)
    setError("")
    setResult(null)
    try {
      const res = await apiFetch("/api/sessions/receipt", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === "SESSION_NOT_FOUND") {
          setError("세션을 찾을 수 없습니다.")
        } else if (data.error === "STORE_MISMATCH") {
          setError("해당 세션은 이 매장의 세션이 아닙니다.")
        } else if (data.error === "RECEIPT_NOT_FOUND") {
          setError("영수증이 없습니다. 정산을 먼저 완료하세요.")
        } else {
          setError(data.message || "영수증 생성에 실패했습니다.")
        }
        return
      }

      setResult({
        snapshot_id: data.snapshot_id ?? "",
        session_id: data.session_id ?? "",
        room_uuid: data.room_uuid ?? "",
        store_uuid: data.store_uuid ?? "",
        created_at: data.created_at ?? "",
      })
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) router.back()
              else router.push("/counter")
            }}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">영수증 조회</span>
          <div className="w-16" />
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 세션 ID 입력 */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="text-sm font-medium text-slate-300">영수증 스냅샷 생성</div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">세션 ID</label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full bg-transparent border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-mono placeholder:text-slate-600"
                placeholder="세션 UUID를 입력하세요..."
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full h-12 rounded-2xl bg-[linear-gradient(90deg,#00adf0,#0070f0)] text-sm font-semibold text-white shadow-[0_8px_30px_rgba(0,173,240,0.3)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? "생성 중..." : "영수증 스냅샷 생성"}
            </button>
            <p className="text-xs text-slate-500">정산이 완료된 세션만 영수증을 생성할 수 있습니다.</p>
          </div>

          {/* 결과 */}
          {result && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]" />
                <div className="text-sm font-medium text-emerald-300">스냅샷 생성 완료</div>
              </div>
              <div className="space-y-2">
                {[
                  { label: "스냅샷 ID", value: result.snapshot_id },
                  { label: "세션 ID", value: result.session_id },
                  { label: "룸 UUID", value: result.room_uuid },
                  { label: "매장 UUID", value: result.store_uuid.slice(0, 8) },
                  { label: "생성 시각", value: result.created_at ? new Date(result.created_at).toLocaleString("ko-KR") : "—" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-1">
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <span className="text-xs font-mono text-slate-200">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 안내 */}
          {!result && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">🧾</div>
              <p className="text-slate-500 text-sm">세션 ID를 입력하고 영수증 스냅샷을 생성하세요.</p>
              <p className="text-slate-600 text-xs mt-1">생성된 스냅샷은 참여자, 주문, 정산 정보를 포함합니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
