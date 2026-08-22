"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"
import { useMe } from "../../../_hooks/useMobileData"
import { fmtHM } from "../../../_lib/format"
import { cn } from "../../../_lib/cn"
import { ChatPatternAction } from "./ChatPatternAction"
import { ChatAutoActionBadge } from "./ChatAutoActionBadge"

type ChatMessage = {
  id: string
  chat_room_id: string
  sender_membership_id: string | null
  sender_name: string | null
  content: string
  created_at: string
  /** R-mine-flag (2026-06-26): 서버가 계산한 본인 여부 — sender_name 부재로 본인 판단하던 버그 제거 */
  is_mine?: boolean
  /** Sprint 3 (2026-07-29): 3-column UI · message_type 별 정렬 */
  message_type?: string
  macro_context?: Record<string, unknown> | null
  undo_deadline_at?: string | null
  superseded_at?: string | null
  session_id?: string | null
}

export default function ChatRoomPage() {
  const params = useParams<{ id: string }>()
  const roomId = decodeURIComponent(params.id ?? "")
  const me = useMe()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [patternEnabled, setPatternEnabled] = useState(false)
  const [patternBusy, setPatternBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const router = useRouter()

  // 채팅방의 패턴 인식 활성화 상태 조회
  useEffect(() => {
    if (!roomId) return
    apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/pattern-toggle`)
      .then((r) => r.json())
      .then((j) => setPatternEnabled(!!j?.pattern_enabled))
      .catch(() => { /* swallow */ })
  }, [roomId])

  async function togglePattern() {
    if (patternBusy) return
    setPatternBusy(true)
    try {
      const res = await apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/pattern-toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !patternEnabled }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      setPatternEnabled(!!j.pattern_enabled)
      toast(`패턴 자동 인식 ${j.pattern_enabled ? "활성화" : "비활성화"}`, "success")
    } catch (e) {
      toast(`전환 실패: ${(e as Error).message}`, "error")
    } finally {
      setPatternBusy(false)
    }
  }

  // R-chat-realtime (2026-06-25): 3초 polling 으로 새 메시지 자동 갱신.
  //   기존엔 mount 시 1회만 fetch → 새로고침 해야 새 메시지 보임.
  //   페이지 가시성 hidden 일 땐 polling 중지 (배경 탭 절약).
  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    async function fetchMessages(initial: boolean) {
      if (initial) setLoading(true)
      try {
        const r = await apiFetch(`/api/chat/messages?chat_room_id=${encodeURIComponent(roomId)}&limit=50`)
        // R-inter-store (2026-07-08): 매장 전환 등으로 방 접근 권한 없으면
        //   자동으로 채팅 목록으로 이동. 403/404 → redirect.
        if (r.status === 403 || r.status === 404) {
          if (initial && !cancelled) {
            toast("이 채팅방에 접근할 수 없습니다 (매장 전환?)", "error")
            router.push("/m/chat")
          }
          return
        }
        const j = await r.json()
        // 서버가 created_at DESC 반환 → UI 는 오래된 위/최신 아래.
        // 한 번에 reverse (in-place 아님, 새 배열).
        const raw = Array.isArray(j?.messages) ? (j.messages as ChatMessage[]) : []
        const next = [...raw].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        if (cancelled) return
        // 중복 제거 — id 기준 (서버는 동일 데이터 반환 가능)
        setMessages((prev) => {
          if (prev.length === next.length) {
            // 같은 길이면 마지막 id 비교로 변경 여부 빠르게 확인
            const lastA = prev[prev.length - 1]?.id
            const lastB = next[next.length - 1]?.id
            if (lastA === lastB) return prev // no change
          }
          return next
        })
      } catch {
        if (initial && !cancelled) toast("메시지를 불러올 수 없습니다", "error")
      } finally {
        if (initial && !cancelled) setLoading(false)
      }
    }
    fetchMessages(true)
    // R-chat-polling-relief (2026-06-26): 3초 → 5초. 100명 동시 × 3초 = 33 QPS 였음.
    //   5초로 → 20 QPS. 메시지 전송 즉시는 setMessages 로 local 반영하므로 UX 동일.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchMessages(false)
    }, 5000)
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchMessages(false)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [roomId, toast])

  // R-chat-scroll-bottom (2026-06-27): 채팅방 진입 시 스크롤 즉시 최하단 (최신 메시지)
  //   으로. 사용자 보고: "스크롤이 최상단으로 올라가는걸 최하단에 맞게".
  //
  //   - useLayoutEffect: DOM 렌더 직후 paint 전에 scroll → 사용자 깜빡임 X.
  //   - 첫 로드는 instant, 새 메시지 도착은 smooth.
  //   - messages.length 0 일 땐 skip.
  const didInitialScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (messages.length === 0) return
    const el = scrollRef.current
    if (!el) return
    const behavior: ScrollBehavior = didInitialScrollRef.current ? "smooth" : "auto"
    el.scrollTo({ top: el.scrollHeight, behavior })
    didInitialScrollRef.current = true
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await apiFetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_room_id: roomId, content: text }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sent = (await res.json()) as ChatMessage
      setMessages((arr) => [...arr, sent])
      setInput("")
    } catch (e) {
      toast(`전송 실패: ${(e as Error).message}`, "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="채팅방"
        subtitle={roomId.slice(0, 12)}
        backHref="/m/chat"
        right={me.data?.is_super_admin ? (
          <button
            type="button"
            onClick={togglePattern}
            disabled={patternBusy}
            className={cn(
              "text-[10px] font-extrabold px-2.5 py-1 rounded-full border",
              patternEnabled
                ? "bg-[#C49B61]/15 text-[#A87D45] border-[#C49B61]/40"
                : "bg-white text-[#7A746A] border-[#D8D2C8]",
            )}
            title="운영자 — 메이드 패턴 자동 인식 토글"
          >
            🎯 자동인식 {patternEnabled ? "ON" : "OFF"}
          </button>
        ) : undefined}
      />

      {/* Sprint 3: 매장 초이스 상태 sticky bar · macro_choice 최신 (superseded 아님) */}
      {(() => {
        const latestChoice = messages
          .filter((m) => m.message_type === "macro_choice" && !m.superseded_at)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
        return latestChoice ? <ChoiceStateSticky msg={latestChoice} /> : null
      })()}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-[200px]">
        {loading && <div className="text-center text-[12px] text-[#7A746A] py-6">불러오는 중...</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">아직 메시지가 없습니다</div>
        )}
        <div className="flex flex-col gap-2">
          {messages
            .filter((m) => {
              // Sprint 3: macro_choice 는 sticky bar 로 이동 · 리스트에서 제외
              if (m.message_type === "macro_choice") return false
              // superseded 된 매크로 도 제외
              if (m.superseded_at) return false
              return true
            })
            .map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                myMembershipId={me.data?.membership_id ?? null}
                myStoreUuid={me.data?.store_uuid ?? null}
                patternEnabled={patternEnabled}
              />
            ))}
        </div>
      </div>

      <div
        className="sticky bottom-0 z-10 border-t border-[#D8D2C8]/60 bg-white px-3 py-2 flex items-center gap-2"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="메시지 입력"
          className="flex-1 bg-[#F8F4ED] border border-[#D8D2C8] rounded-full px-4 py-2 text-[13px] outline-none focus:border-[#C49B61]"
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white font-extrabold disabled:opacity-40"
        >
          ↑
        </button>
      </div>

      <TabBar />
    </div>
  )
}

/**
 * Sprint 3 (2026-07-29): 3-column MessageBubble.
 *   - 일반 (text/system) : 카톡 스타일 좌/우 (내/남)
 *   - macro_maid · macro_end · macro_extend · macro_nfc : 우측 카드 (초록/회색)
 *   - macro_choice : 중앙 sticky (매장 초이스 상태)
 *   - macro_confirm : 중앙 강조 (pending 확인 요청)
 *
 *   추가:
 *   - Undo 카운트다운 (매크로 5분 유예 · undo_deadline_at)
 *   - 매크로 취소 버튼 (POST /api/chat/messages/[id]/undo)
 */
function MessageBubble({ msg, myMembershipId, myStoreUuid, patternEnabled }: { msg: ChatMessage; myMembershipId: string | null; myStoreUuid: string | null; patternEnabled: boolean }) {
  const isMine = msg.is_mine === true || (myMembershipId != null && msg.sender_membership_id === myMembershipId)
  const type = msg.message_type ?? "text"

  // 매크로: 우측 카드 (초록/회색/오렌지)
  if (type === "macro_maid" || type === "macro_extend" || type === "macro_nfc") {
    return <MacroCard msg={msg} variant="live" />
  }
  if (type === "macro_end") {
    return <MacroCard msg={msg} variant="end" />
  }
  if (type === "macro_confirm") {
    return <MacroCard msg={msg} variant="confirm" />
  }
  // macro_choice 는 별도 · 상단 sticky · 리스트에서 필터되므로 여기 안 옴
  // (safety) 만약 오더라도 중앙 배치
  if (type === "macro_choice") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[92%] rounded-xl px-3 py-2 border-2 bg-[#FEF3C7] border-[#F59E0B] text-[#78350F] text-[12px] font-bold text-center">
          {msg.content}
        </div>
      </div>
    )
  }
  // system 은 중앙 · 작음 · 회색
  if (type === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[78%] rounded-lg px-3 py-1.5 bg-[#EDE7DA]/60 text-[#7A746A] text-[10px] font-bold whitespace-pre-line text-center">
          {msg.content}
        </div>
      </div>
    )
  }
  // 기본 text: 카톡 스타일 좌/우
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div className="max-w-[78%]">
        {!isMine && msg.sender_name && (
          <div className="text-[10px] font-bold text-[#7A746A] mb-0.5 px-1">{msg.sender_name}</div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13px] font-medium",
            isMine
              ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-tr-sm"
              : "bg-white border border-[#D8D2C8]/60 text-[#2D2B26] rounded-tl-sm",
          )}
        >
          {msg.content}
        </div>
        {patternEnabled && (
          <ChatPatternAction content={msg.content} chatMessageId={msg.id} myStoreUuid={myStoreUuid} />
        )}
        <ChatAutoActionBadge messageId={msg.id} />
        <div className={cn("text-[9px] text-[#7A746A] mt-0.5", isMine ? "text-right" : "text-left", "px-1")}>
          {fmtHM(msg.created_at)}
        </div>
      </div>
    </div>
  )
}

/**
 * Sprint 3+4: 매크로 카드.
 *   variant:
 *     live    = 등록 · 초록 · 우측 · undo 5분 유예
 *     end     = 종료 · 회색 · 우측
 *     confirm = 확인 요청 · 중앙 오렌지 · [예/아니오] 원탭 (Sprint 4)
 */
function MacroCard({ msg, variant }: { msg: ChatMessage; variant: "live" | "end" | "confirm" }) {
  const [busy, setBusy] = useState<"undo" | "confirm" | "reject" | null>(null)
  const [done, setDone] = useState<"undone" | "confirmed" | "rejected" | null>(null)
  const [remainingSec, setRemainingSec] = useState<number | null>(null)

  useEffect(() => {
    if (!msg.undo_deadline_at) { setRemainingSec(null); return }
    const compute = () => {
      const rem = Math.max(0, Math.floor((new Date(msg.undo_deadline_at!).getTime() - Date.now()) / 1000))
      setRemainingSec(rem)
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [msg.undo_deadline_at])

  async function undo() {
    if (busy || done) return
    if (!confirm("이 매크로를 취소하시겠습니까? (세션도 archived 됩니다)")) return
    setBusy("undo")
    try {
      const res = await apiFetch(`/api/chat/messages/${encodeURIComponent(msg.id)}/undo`, { method: "POST" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      setDone("undone")
    } catch (e) {
      alert(`취소 실패: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function confirmMacro() {
    if (busy || done) return
    setBusy("confirm")
    try {
      const res = await apiFetch(`/api/chat/messages/${encodeURIComponent(msg.id)}/confirm-macro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      setDone("confirmed")
    } catch (e) {
      alert(`등록 실패: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function rejectMacro() {
    if (busy || done) return
    const reason = prompt("거부 사유 (선택 · 없으면 취소):", "")
    if (reason === null) return
    setBusy("reject")
    try {
      const res = await apiFetch(`/api/chat/messages/${encodeURIComponent(msg.id)}/reject-macro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      setDone("rejected")
    } catch (e) {
      alert(`거부 실패: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const align = variant === "confirm" ? "justify-center" : "justify-end"
  const cardCls =
    variant === "live"
      ? "bg-[#DCFCE7] border border-[#5FAB4E]/40 text-[#166534]"
      : variant === "end"
        ? "bg-[#F3F4F6] border border-[#D1D5DB] text-[#4B5563]"
        : "bg-[#FEF3C7] border-2 border-[#F59E0B] text-[#78350F]"

  const canUndo = variant === "live" && remainingSec !== null && remainingSec > 0 && !done
  const canConfirm = variant === "confirm" && !done

  return (
    <div className={cn("flex", align)}>
      <div className={cn(
        variant === "confirm" ? "max-w-[92%]" : "max-w-[80%]",
        "rounded-2xl px-3.5 py-2.5",
        cardCls,
        done && "opacity-40 line-through",
      )}>
        <div className="text-[12px] font-bold whitespace-pre-line leading-tight">
          {msg.content}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[9px] font-semibold opacity-70">{fmtHM(msg.created_at)}</span>
          {canUndo && (
            <>
              <span className="text-[9px] font-black text-red-600">
                취소가능 {Math.floor(remainingSec! / 60)}:{String(remainingSec! % 60).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={undo}
                disabled={busy !== null}
                className="ml-auto rounded px-2 py-0.5 text-[10px] font-black bg-white/70 border border-red-400 text-red-700 disabled:opacity-40"
              >
                {busy === "undo" ? "..." : "✕ 취소"}
              </button>
            </>
          )}
          {canConfirm && (
            <>
              <button
                type="button"
                onClick={confirmMacro}
                disabled={busy !== null}
                className="ml-auto rounded-lg px-3 py-1 text-[11px] font-black bg-[#166534] text-white disabled:opacity-40"
              >
                {busy === "confirm" ? "..." : "✓ 예 · 등록"}
              </button>
              <button
                type="button"
                onClick={rejectMacro}
                disabled={busy !== null}
                className="rounded-lg px-3 py-1 text-[11px] font-black bg-white border-2 border-[#78350F] text-[#78350F] disabled:opacity-40"
              >
                {busy === "reject" ? "..." : "✕ 아니오"}
              </button>
            </>
          )}
          {done === "undone" && <span className="ml-auto text-[9px] font-black text-red-700">✕ 취소됨</span>}
          {done === "confirmed" && <span className="ml-auto text-[9px] font-black text-[#166534]">✓ 등록됨</span>}
          {done === "rejected" && <span className="ml-auto text-[9px] font-black text-red-700">✕ 거부됨</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * Sprint 3: 매장 초이스 상태 sticky bar (상단 고정).
 *   messages 리스트에서 macro_choice · superseded_at=null 인 최근 것 표시.
 *   실시간 업데이트 반영 (poll 결과 갱신 시 자동 refresh).
 */
function ChoiceStateSticky({ msg }: { msg: ChatMessage }) {
  return (
    <div
      className="sticky top-0 z-20 px-3 py-2 bg-[#FEF3C7] border-y-2 border-[#F59E0B] shadow-sm"
    >
      <div className="flex items-center gap-2 text-[12px] font-black text-[#78350F]">
        <span className="text-[14px]">🔥</span>
        <span className="flex-1 truncate">{msg.content}</span>
        <span className="text-[9px] font-semibold opacity-70 shrink-0">실시간</span>
      </div>
    </div>
  )
}
