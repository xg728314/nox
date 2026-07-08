"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

/**
 * 채팅 메시지 하나에 대해 서버가 자동 처리한 결과 배지.
 *   - waiting_request success 감지 시 "⏰ 자동 대기 등록" 배지
 *   - waiting_request skipped 감지 시 "· 중복 무시 (60초)" 표시
 *
 * ChatPatternAction 은 dispatch 흐름 (참여자 등록) 담당.
 * 이 컴포넌트는 waiting_request (매장 간 대기 요청) 담당.
 *
 * R-auto-ops-ui (2026-07-08).
 */
type Action = {
  id: string
  action_type: string
  parsed_json: unknown
  ref_id: string | null
  status: string
  error_message: string | null
  created_at: string
}
type WaitingRequest = {
  id: string
  categories: string[]
  guest_count: number | null
  room_count: number | null
  tags: string[]
  guest_note: string | null
  status: string
  matched_at: string | null
  expires_at: string
  created_at: string
}

export function ChatAutoActionBadge({ messageId }: { messageId: string }) {
  const [data, setData] = useState<{ actions: Action[]; waiting_request: WaitingRequest | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch(`/api/chat/auto-action-status?message_id=${messageId}`)
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          setData(j)
        }
      } catch {
        // 실패해도 조용히
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [messageId])

  if (loading) return null
  if (!data || data.actions.length === 0) return null

  const successAction = data.actions.find(
    (a) => a.action_type === "waiting_request" && a.status === "success",
  )
  const skippedCount = data.actions.filter(
    (a) => a.action_type === "waiting_request" && a.status === "skipped",
  ).length

  // waiting_request 없으면 dispatch/session_event 감사만 있을 수 있음 — skip
  if (!successAction) return null

  const wr = data.waiting_request
  const isActive = wr?.status === "active"
  const isMatched = wr?.status === "matched"
  const isExpired = wr && new Date(wr.expires_at).getTime() < Date.now()

  const stateColor = isMatched
    ? "bg-green-100 border-green-300 text-green-800"
    : isExpired
      ? "bg-gray-100 border-gray-300 text-gray-600"
      : isActive
        ? "bg-amber-50 border-amber-300 text-amber-800"
        : "bg-gray-100 border-gray-300 text-gray-600"

  const stateLabel = isMatched
    ? "✓ 매칭됨"
    : isExpired
      ? "만료"
      : isActive
        ? "대기 중"
        : wr?.status ?? "?"

  return (
    <div className={`mt-1.5 border rounded-2xl px-3 py-2 text-[11px] ${stateColor}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[13px]">⏰</span>
        <span className="font-extrabold">자동 대기 등록</span>
        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${
          isMatched ? "bg-green-500 text-white"
          : isExpired ? "bg-gray-400 text-white"
          : "bg-amber-500 text-white"
        }`}>
          {stateLabel}
        </span>
      </div>
      {wr && (
        <div className="text-[11px] font-bold">
          {wr.categories.join(" · ")}
          {wr.guest_count && (
            <span className="ml-1">
              {wr.guest_count}인
              {wr.room_count && wr.room_count > 0 ? `${wr.room_count}빵` : ""}
            </span>
          )}
        </div>
      )}
      {wr?.tags && wr.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {wr.tags.map((t) => (
            <span key={t} className="text-[9px] font-bold bg-white/70 px-1.5 py-0.5 rounded-full">
              #{t}
            </span>
          ))}
        </div>
      )}
      {wr?.guest_note && (
        <div className="text-[10px] italic mt-1 opacity-80">💬 {wr.guest_note}</div>
      )}
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-current/20">
        {skippedCount > 0 && (
          <span className="text-[9px] opacity-70">· 중복 {skippedCount}건 무시 (60초)</span>
        )}
        <Link
          href={`/m/waiting`}
          className="text-[10px] font-extrabold underline underline-offset-2 ml-auto"
        >
          목록 보기 →
        </Link>
      </div>
    </div>
  )
}
