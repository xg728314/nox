"use client"
import { useApi } from "../../../_hooks/useApi"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"

/**
 * 자동 처리 감사 로그 (/m/ops/auto-actions).
 *   R-auto-ops (2026-07-08). 실장이 채팅 → 자동 처리 결과 확인.
 *   대기 요청 자동 등록 / dispatch / 세션 이벤트 / 손님 태그.
 */
type Action = {
  id: string
  chat_message_id: string
  action_type: string
  parsed_json: unknown
  ref_id: string | null
  ref_table: string | null
  status: string
  error_message: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, { emoji: string; label: string; color: string }> = {
  waiting_request: { emoji: "⏰", label: "대기 요청", color: "bg-amber-50 border-amber-200 text-amber-800" },
  dispatch: { emoji: "🚀", label: "dispatch", color: "bg-blue-50 border-blue-200 text-blue-800" },
  session_event: { emoji: "🔄", label: "세션 이벤트", color: "bg-purple-50 border-purple-200 text-purple-800" },
  guest_tag: { emoji: "🧑‍💼", label: "손님 태그", color: "bg-green-50 border-green-200 text-green-800" },
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-green-500 text-white",
  skipped: "bg-gray-400 text-white",
  failed: "bg-red-500 text-white",
}

export default function AutoActionsPage() {
  const { data, isLoading } = useApi<{ actions: Action[] }>(
    "/api/ops/auto-actions?limit=100",
    { ttl: 20_000 },
  )
  const actions = data?.actions ?? []

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="자동 처리 감사"
        subtitle="채팅 → 자동 실행된 액션 이력"
        backHref="/m/me"
      />

      <div className="px-5 pb-24">
        <div className="text-[10px] font-semibold text-[#7A746A] bg-blue-50 border border-blue-200 rounded-2xl px-3 py-2.5 leading-snug mb-3">
          채팅 메시지가 자동으로 대기 요청 · dispatch · 세션 이벤트 · 손님 태그로
          변환된 이력. 오작동 시 원본 메시지와 파싱 결과 확인 가능.
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && actions.length === 0 && (
          <div className="text-center py-10 text-[12px] text-[#7A746A]">
            자동 처리 이력 없음
          </div>
        )}

        <div className="space-y-2">
          {actions.map((a) => {
            const info = TYPE_LABEL[a.action_type] ?? {
              emoji: "•",
              label: a.action_type,
              color: "bg-gray-50 border-gray-200 text-gray-800",
            }
            const statusCls = STATUS_STYLE[a.status] ?? "bg-gray-400 text-white"
            return (
              <div
                key={a.id}
                className={`border-2 rounded-2xl p-3 ${info.color}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[14px]">{info.emoji}</span>
                  <span className="text-[11px] font-extrabold">{info.label}</span>
                  <span
                    className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${statusCls}`}
                  >
                    {a.status}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[9px] font-bold opacity-70">
                    {new Date(a.created_at).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
                {a.error_message && (
                  <div className="text-[10px] font-semibold text-red-700 mb-1">
                    ⚠ {a.error_message}
                  </div>
                )}
                <details className="text-[10px]">
                  <summary className="cursor-pointer opacity-70">파싱 결과</summary>
                  <pre className="mt-1 text-[9px] bg-white/60 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(a.parsed_json, null, 2)}
                  </pre>
                </details>
              </div>
            )
          })}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
