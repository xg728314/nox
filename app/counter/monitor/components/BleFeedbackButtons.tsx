"use client"

/**
 * BleFeedbackButtons — 👍 / 👎 accuracy quick-taps.
 *
 * Writes exactly one `ble_feedback` row per click. Never mutates
 * business state. Subject is supplied by the caller (ActionPopover).
 * The server enforces visibility + store scope.
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type FeedbackSubject = {
  membership_id: string
  participant_id: string | null
  session_id: string | null
  zone: string | null
  room_uuid: string | null
  gateway_id?: string | null
}

type Props = {
  subject: FeedbackSubject | null
  onSubmitted?: () => void
  /** Compact variant for tight surfaces (e.g. map overlay). */
  size?: "sm" | "md"
}

type Choice = "positive" | "negative"

export default function BleFeedbackButtons({ subject, onSubmitted, size = "md" }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState<Choice | null>(null)
  const [error, setError] = useState<string>("")

  const click = async (type: Choice) => {
    if (!subject || busy) return
    setBusy(type)
    setError("")
    try {
      const r = await apiFetch("/api/ble/feedback", {
        method: "POST",
        body: JSON.stringify({
          membership_id: subject.membership_id,
          participant_id: subject.participant_id,
          session_id: subject.session_id,
          zone: subject.zone,
          room_uuid: subject.room_uuid,
          gateway_id: subject.gateway_id ?? null,
          feedback_type: type,
          source: "manual_tap",
        }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        setError(body.message ?? body.error ?? "기록 실패")
        return
      }
      setChoice(type)
      onSubmitted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류")
    } finally {
      setBusy(null)
    }
  }

  const cls = size === "sm" ? "text-[11px] py-1" : "text-[12px] py-1.5"

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!subject || !!busy}
          onClick={() => click("positive")}
          className={`flex-1 px-2 rounded-lg border font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${cls} ${
            choice === "positive"
              ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-100 ring-1 ring-emerald-400/50"
              : "bg-emerald-500/10 border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/20"
          }`}
          title="이 위치 정보가 정확합니다"
        >
          👍 정확해요
        </button>
        <button
          type="button"
          disabled={!subject || !!busy}
          onClick={() => click("negative")}
          className={`flex-1 px-2 rounded-lg border font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${cls} ${
            choice === "negative"
              ? "bg-red-500/25 border-red-500/60 text-red-100 ring-1 ring-red-400/50"
              : "bg-red-500/10 border-red-500/35 text-red-200 hover:bg-red-500/20"
          }`}
          title="이 위치 정보가 잘못되었습니다"
        >
          👎 틀렸어요
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-red-300 px-1">{error}</div>
      )}
      {choice && !error && (
        <div className="text-[10px] text-slate-500 px-1">
          {choice === "positive" ? "정확 기록됨" : "오탐 기록됨"} · 다시 누르려면 다음 갱신 후 가능
        </div>
      )}
    </div>
  )
}
