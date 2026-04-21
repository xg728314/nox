"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import ReceiptRenderer from "@/lib/receipt/ReceiptRenderer"
import { downloadReceiptPng } from "@/lib/receipt/PngRenderer"
import { apiFetch } from "@/lib/apiFetch"
import type { ReceiptDocument } from "@/lib/receipt/types"

export default function ReceiptViewerPage({
  params,
}: {
  params: Promise<{ snapshot_id: string }>
}) {
  const { snapshot_id } = use(params)
  const router = useRouter()
  const [doc, setDoc] = useState<ReceiptDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/sessions/receipt?snapshot_id=${snapshot_id}`)
        if (res.ok) {
          const d = await res.json()
          const snap = d.snapshot
          if (snap?.snapshot) {
            const receiptDoc: ReceiptDocument = { ...snap.snapshot, is_reprint: true, original_snapshot_id: snap.id }
            setDoc(receiptDoc)
          } else {
            setError("스냅샷 데이터를 찾을 수 없습니다.")
          }
        } else {
          setError("계산서를 불러올 수 없습니다.")
        }
      } catch {
        setError("서버 오류")
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot_id])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex items-center justify-center">
        <div className="text-cyan-400 text-sm animate-pulse">로딩 중...</div>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen bg-[#0a0c14] flex flex-col items-center justify-center gap-3">
        <p className="text-red-400 text-sm">{error || "계산서를 찾을 수 없습니다."}</p>
        <button onClick={() => router.back()} className="text-cyan-400 text-sm underline">돌아가기</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0c14]/95 backdrop-blur border-b border-white/[0.07] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-lg">&larr;</button>
          <span className="text-base font-bold">
            {doc.receipt_type === "final"
              ? "최종 계산서"
              : doc.calc_mode === "half_ticket"
                ? "중간 계산서 (반티 기준)"
                : doc.receipt_type === "interim"
                  ? "중간 계산서 (현재까지 논 시간 기준)"
                  : "중간 계산서"}
          </span>
          {doc.room_label && (
            <span className="text-[11px] text-slate-500">{doc.room_label}</span>
          )}
          {doc.is_reprint && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">재출력</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => downloadReceiptPng(doc)}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
          >
            PNG 저장
          </button>
          <button
            onClick={() => window.print()}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
          >
            인쇄
          </button>
        </div>
      </div>

      {/* Receipt preview — fit content, not full-screen white */}
      <div className="px-4 py-6 flex justify-center">
        <div className="w-fit">
          <ReceiptRenderer doc={doc} mode="preview" />
        </div>
      </div>
    </div>
  )
}
