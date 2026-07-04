"use client"
import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useApi, invalidateApi } from "../_hooks/useApi"
import { useToast, haptic } from "./Toast"

/**
 * 긴급 SOS 버튼 + 진행 중 배너.
 *   - 롱프레스 (1.5초) 또는 확인 sheet 로 발동.
 *   - 매장 owner/manager 에게 push 자동.
 *   - 진행 중 SOS 있으면 배너로 표시 + 해결 버튼.
 *
 * R-sos (2026-06-28).
 */
type SosEvent = {
  id: string
  kind: string
  message: string | null
  sender_role: string | null
  created_at: string
}

export function SosButton() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<"help" | "complaint" | "emergency">("emergency")
  const [message, setMessage] = useState("")
  const toast = useToast()

  // 진행중 SOS (owner/manager 만 조회 성공)
  const { data: activeData } = useApi<{ events: SosEvent[] }>("/api/sos", {
    ttl: 15_000,
  })
  const active = activeData?.events ?? []

  async function send() {
    if (busy) return
    setBusy(true)
    haptic([50, 30, 50, 30, 50])
    try {
      const res = await apiFetch("/api/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: message.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`✅ SOS 발송됨 (${j.notified ?? 0}명 알림)`, "success")
      setConfirmOpen(false)
      setMessage("")
      invalidateApi("/api/sos")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  async function resolve(id: string) {
    try {
      const res = await apiFetch(`/api/sos/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolved" }),
      })
      if (res.ok) {
        toast("SOS 해결 처리", "success")
        invalidateApi("/api/sos")
      }
    } catch {}
  }

  return (
    <>
      {/* 진행중 SOS 배너 (owner/manager) */}
      {active.map((e) => (
        <div
          key={e.id}
          className="bg-red-500 text-white rounded-2xl px-3 py-2.5 mb-2 flex items-center gap-2 animate-pulse"
        >
          <span className="text-[18px]">🚨</span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold leading-tight">
              {e.kind === "help"
                ? "🆘 도움 요청"
                : e.kind === "complaint"
                  ? "😠 컴플레인"
                  : "🚨 긴급 상황"}{" "}
              — {e.sender_role}
            </div>
            {e.message && (
              <div className="text-[10px] font-semibold opacity-90 truncate mt-0.5">
                {e.message}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => resolve(e.id)}
            className="text-[10px] font-extrabold bg-white text-red-600 rounded-full px-3 py-1.5 shrink-0"
          >
            해결
          </button>
        </div>
      ))}

      {/* SOS 버튼 (홈 오른쪽 하단 fixed) */}
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full bg-red-500 text-white text-[22px] font-extrabold shadow-[0_8px_24px_rgba(239,68,68,0.5)] active:scale-90 transition-transform"
        aria-label="SOS 긴급 호출"
        title="긴급 호출"
      >
        🆘
      </button>

      {/* Confirm sheet */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 space-y-3 max-w-[420px] mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center pb-2">
              <div className="text-[22px] font-extrabold text-red-600">
                🚨 긴급 호출
              </div>
              <div className="text-[11px] font-semibold text-[#7A746A] mt-1">
                매장 실장/사장에게 즉시 알림
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { k: "emergency", l: "🚨 긴급", c: "bg-red-500" },
                  { k: "help", l: "🆘 도움", c: "bg-orange-500" },
                  { k: "complaint", l: "😠 컴플레인", c: "bg-amber-500" },
                ] as const
              ).map((o) => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setKind(o.k)}
                  className={`rounded-2xl py-3 text-[11px] font-extrabold ${
                    kind === o.k ? `${o.c} text-white` : "bg-[#EFEBE3] text-[#7A746A]"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="상황 (선택) — 예: 3번방 손님 진상, 도움 필요"
              rows={2}
              className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-2xl px-3 py-2.5 text-[13px] outline-none"
              autoFocus
            />

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="flex-1 bg-[#EFEBE3] rounded-2xl py-3 text-[13px] font-extrabold disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={send}
                disabled={busy}
                className="flex-1 bg-red-500 text-white rounded-2xl py-3 text-[13px] font-extrabold disabled:opacity-40 shadow-lg"
              >
                {busy ? "발송 중..." : "🚨 발송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
