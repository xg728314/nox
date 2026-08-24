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
  // R-help-modal (2026-08-23): 메이드톡 파서 인식 범위 설명
  const [helpOpen, setHelpOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomAnchorRef = useRef<HTMLDivElement>(null)
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

  // R-chat-scroll-bottom (2026-06-27): 채팅방 진입 시 스크롤 즉시 최하단 (최신 메시지) 으로.
  //   R-scroll-hardening (2026-08-25): 사용자 리포트 "다른 메뉴에 있다가 채팅 메뉴를
  //   누르면 최근 채팅이 아닌 이전 채팅 상단이 뜬다". 원인: 첫 render 시 setMessages
  //   반영 → useLayoutEffect trigger → el.scrollHeight 계산 시점에 MessageBubble
  //   내부 (이미지 · sticky UI · ChatPatternAction 카드) 아직 layout 확정 전 →
  //   scroll bottom 실행되지만 그 시점 scrollHeight 가 최종보다 작음 → 실제로는
  //   중간~상단에 멈춤.
  //
  //   Fix: 4-tier retry (immediate + rAF×2 + 100ms + 500ms) · 모든 async 요소가
  //   확정된 후 재확인. 첫 mount 는 instant · 이후 새 메시지는 smooth.
  const didInitialScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (messages.length === 0) return
    const behavior: ScrollBehavior = didInitialScrollRef.current ? "smooth" : "auto"
    // scrollIntoView 는 nearest scroll container 를 브라우저가 자동 계산 · 여러
    //   중첩 scroll container (phone frame + 내부 flex-1) 이 있어도 정확 안 함.
    //   block:"end" 로 anchor 를 뷰포트 하단에 정렬.
    const scrollToBottom = () => {
      bottomAnchorRef.current?.scrollIntoView({ behavior, block: "end" })
      // 폴백: scrollRef 도 함께 (일부 브라우저 scrollIntoView smooth 무시 대비)
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    }
    scrollToBottom()
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(scrollToBottom)
      ;(raf1 as unknown as { raf2?: number }).raf2 = raf2
    })
    const t1 = window.setTimeout(scrollToBottom, 100)
    const t2 = window.setTimeout(scrollToBottom, 500)
    didInitialScrollRef.current = true
    return () => {
      cancelAnimationFrame(raf1)
      const raf2 = (raf1 as unknown as { raf2?: number }).raf2
      if (raf2) cancelAnimationFrame(raf2)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
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
      // R-msg-id-normalize (2026-08-23): 서버 POST 응답 필드 = `message_id` (not `id`).
      //   기존: `sent.id === undefined` → ChatPatternAction 이 발화 안 함
      //   (auto-fire useEffect 의 chatMessageId guard 실패). 새 메시지 파싱 자동 등록
      //   되던 흐름이 완전 stuck 이었음. 서버 스키마 변경 위험보다 client 정규화가 안전.
      const raw = (await res.json()) as Partial<ChatMessage> & { message_id?: string }
      const sent: ChatMessage = {
        ...raw,
        id: raw.id ?? raw.message_id ?? "",
      } as ChatMessage
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
        right={
          <div className="flex items-center gap-1.5">
            {/* R-help-modal (2026-08-23): 메이드톡 인식 범위 설명서 */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="text-[10px] font-extrabold px-2 py-1 rounded-full border bg-white text-[#7A746A] border-[#D8D2C8]"
              title="메이드톡 인식 범위 · 예시"
            >
              📖 설명서
            </button>
            {me.data?.is_super_admin && (
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
            )}
          </div>
        }
      />

      {/* R-help-modal (2026-08-23): 설명서 모달 · 파서 인식 범위 매뉴얼 */}
      {helpOpen && <ChatHelpModal onClose={() => setHelpOpen(false)} />}

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
          {/* R-scroll-anchor (2026-08-25): scrollIntoView 대상 · 리스트 최하단.
             부모 flex-1 overflow-auto 스크롤이 자식 layout 확정 전엔 scrollHeight
             계산 부정확한 문제 · 명시적 anchor 로 브라우저에게 "여기까지 보이게" 위임. */}
          <div ref={bottomAnchorRef} />
          {/* R-input-overlap-spacer (2026-08-25): 사용자 리포트 "메시지 입력칸 뒤로
             채팅글이 보인다". sticky bottom input 이 scroll container 안이라 마지막
             메시지가 스크롤 시 input 뒤로 살짝 겹침. 명시적 spacer 로 input 높이만큼
             (input area ~56px + safe-area) 여백 확보 · 마지막 메시지가 input 위에 온전히 표시. */}
          <div className="shrink-0" style={{ height: "calc(56px + env(safe-area-inset-bottom))" }} />
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

/**
 * R-help-modal (2026-08-23): 메이드톡 파서 인식 범위 매뉴얼.
 *   실장 사용자가 어떤 표기가 자동 인식되는지 확인 · 학습.
 *   실 파서 스펙 (staffChatParser.ts + storeRegistry.ts) 기반.
 */
function ChatHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-[15px] font-extrabold text-[#2D2B26]">📖 메이드톡 인식 범위</div>
          <button
            type="button"
            onClick={onClose}
            className="text-[16px] font-bold text-[#7A746A] px-2"
          >✕</button>
        </div>

        <div className="text-[11px] font-bold text-[#7A746A] mb-3">
          아래 표기 방식은 자동으로 인식되어 세션이 등록됩니다.<br/>
          <span className="text-[#A87D45]">한 줄에 순서 자유</span> · 앞뒤 인사말 무시.
        </div>

        {/* 형식 */}
        <Section title="✅ 기본 형식">
          <Row label="본매장 방번호+이름+종목+티켓" ex="1번방 지수 셔 완메" />
          <Row label="매장명 명시" ex="마 1번방 지수 셔 완메" />
          <Row label="여러 명 · 같은 종목" ex="1번방 지수 은빈 효미 퍼 완메" />
          <Row label="이름별 종목 구분" ex="1번방 지수 은빈 퍼 효리 셔 완메" />
        </Section>

        {/* 방번호 */}
        <Section title="🚪 방번호 표기 (모두 인식)">
          <Row label="번방/번룸/호실" ex="1번방 · 3번룸 · 2호실" />
          <Row label="축약" ex="1t · 1T · 1티" />
          <Row label="단독 번" ex="1번" />
          <Row label="라인 어디에나" ex="마 지수 5번방 셔 완메" />
        </Section>

        {/* 매장 */}
        <Section title="🏢 매장 표기">
          <div className="grid grid-cols-4 gap-1 text-[10px] font-bold mb-1">
            {[
              ["라이브","라"],["마블","마"],["버닝","버"],["황진이","황"],
              ["신세계","신"],["아우라","아우"],["아지트","아지"],["퍼스트","퍼스"],
              ["두바이","두"],["발리","발/팔"],["상한가","상"],["토끼","토"],
              ["8번가","8번가"],["썸","썸"],["파티","파"],
            ].map(([full, ab]) => (
              <div key={full} className="rounded bg-[#F3EEE3] px-1 py-1 text-center">
                <div className="text-[10px] font-extrabold text-[#2D2B26]">{full}</div>
                <div className="text-[9px] text-[#A87D45]">{ab}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-[#7A746A] font-bold">
            💡 매장 생략 시 자기 매장으로 자동 등록.
          </div>
        </Section>

        {/* 종목 */}
        <Section title="🎯 종목 (카테고리)">
          <Row label="퍼블릭" ex="퍼 · 퍼블릭" />
          <Row label="셔츠" ex="셔 · 셔츠" />
          <Row label="하퍼" ex="하 · 하퍼" />
        </Section>

        {/* 티켓 */}
        <Section title="🎟 티켓 (시간)">
          <Row label="완티 (기본)" ex="완메 · 완티 · 메이드 · 완 · ㅁㅇㄷ" />
          <Row label="반티 (반)" ex="반티 · 반메 · 반" />
          <Row label="차3 (짧게)" ex="차3 · 차" />
          <Row label="반차3 (반+차3)" ex="반차3 · 반차 · 반3 · ㅂ3" />
        </Section>

        {/* 그룹핑 */}
        <Section title="🔗 이름-종목 그룹핑">
          <div className="text-[11px] font-bold text-[#2D2B26] mb-1">
            <code className="bg-[#F3EEE3] px-1 rounded">1번방 지수 은빈 효미 <b className="text-blue-600">퍼</b> 효리 <b className="text-red-600">셔</b> 반차3 메이드</code>
          </div>
          <div className="text-[10px] text-[#7A746A] font-bold ml-1">
            → 지수/은빈/효미 = <b className="text-blue-600">퍼블릭·반차3</b><br/>
            → 효리 = <b className="text-red-600">셔츠·반차3</b>
          </div>
        </Section>

        {/* 여러 매장 */}
        <Section title="🏬 여러 매장 (Cross-store)">
          <div className="text-[11px] font-bold text-[#2D2B26] mb-1">
            <code className="bg-[#F3EEE3] px-1 rounded">1번방 마 지수 퍼 신 은빈 셔 완메</code>
          </div>
          <div className="text-[10px] text-[#7A746A] font-bold ml-1">
            → 마블·지수·퍼블릭·완티<br/>
            → 신세계·은빈·셔츠·완티
          </div>
        </Section>

        {/* 자동 처리 */}
        <Section title="⚡ 자동 처리">
          <ul className="text-[11px] text-[#2D2B26] font-bold list-disc pl-4 space-y-1">
            <li>미등록 아가씨 → <span className="text-[#A87D45]">자동 등록 (임시)</span></li>
            <li>세션 자동 생성 + 참여자 배정</li>
            <li>자동 <span className="text-[#5FAB4E]">출근 체크 · 방중 상태</span></li>
            <li>정산 자동 반영 (실장별 세분화)</li>
          </ul>
        </Section>

        {/* 인사말 / 노이즈 */}
        <Section title="🧹 무시되는 문구 (안전)">
          <div className="text-[10px] text-[#7A746A] font-bold">
            아래는 자동으로 무시됩니다 (아가씨로 오등록 안 됨):
          </div>
          <ul className="text-[10px] text-[#7A746A] font-bold list-disc pl-4 mt-1 space-y-0.5">
            <li>&quot;안녕하세요&quot; · &quot;감사합니다&quot; · &quot;부탁드립니다&quot;</li>
            <li>티켓 이후 붙은 인사말: &quot;완메 잘부탁드려요&quot;</li>
            <li>5글자 이상 한글 (실 이름 최대 4자 기준)</li>
            <li>특수문자 · 이모지</li>
          </ul>
        </Section>

        {/* 팁 */}
        <Section title="💡 팁">
          <ul className="text-[10px] text-[#7A746A] font-bold list-disc pl-4 space-y-1">
            <li>이름 뒤 오탈자로 잘못 등록되면 → 조판에서 <b>중복 배지</b> 클릭해 병합</li>
            <li>실장 대신 체크인 → 외부조판 세션에서 <b>실장 변경</b> 버튼</li>
            <li>이름 수정 → 채팅 카드 ✏️ 클릭 or /m/hostess-manage</li>
          </ul>
        </Section>

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 rounded-lg py-2.5 text-[12px] font-extrabold bg-[#2D2B26] text-white"
        >
          닫기
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl bg-[#FBF6EC]/50 border border-[#EDE7DA] p-2.5">
      <div className="text-[12px] font-extrabold text-[#A87D45] mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, ex }: { label: string; ex: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-[10px] font-bold text-[#7A746A] w-24 shrink-0">{label}</span>
      <code className="text-[11px] font-extrabold text-[#2D2B26] bg-white/70 px-1 rounded flex-1">{ex}</code>
    </div>
  )
}
