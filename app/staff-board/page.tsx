"use client"

/**
 * /staff-board — 매장간 스태프 요청·가용 보드.
 *
 * R-Staff-Board (2026-05-01): 카톡 그룹채팅 도배 패턴 대체.
 *
 * 운영자 의도:
 *   "지금까지 카톡으로 매장간 스태프 요청을 했는데 같은 메시지 도배되고
 *    응답 추적도 안 된다. NOX 안에 매장당 1행 카드로 구조화해서 한눈에
 *    본다. 알림은 끄고 켤 수 있다."
 *
 * 구성:
 *   - 상단: 알림 설정 토글 (board_new_request / board_response / sound)
 *   - 본인 매장 카드 영역 (있으면 편집/취소, 없으면 [+ 등록])
 *   - 다른 매장 카드 list (need / available 탭)
 *   - 카드 클릭 → 응답 modal
 *
 * polling: 10초 (visibility-aware). chat 패턴 차용.
 *
 * 권한:
 *   - hostess / staff: 본 페이지 접근 X (운영자 영역). middleware 차단 후
 *     /me/home redirect. 본 페이지는 owner / manager / waiter 만.
 */

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { getServerNow } from "@/lib/time/serverClock"

type BoardItem = {
  id: string
  store_uuid: string
  store_label: string
  request_kind: "need" | "available"
  service_types: string[]
  party_size: number
  tags: string[]
  memo: string | null
  posted_at: string
  expires_at: string
  status: string
  update_count: number
  is_mine: boolean
  response_count: number
}

type Preferences = {
  board_new_request: boolean
  board_response: boolean
  sound_enabled: boolean
  desktop_notification: boolean
  push_enabled: boolean
  kakao_alimtalk: boolean
}

const DEFAULT_PREFS: Preferences = {
  board_new_request: true,
  board_response: true,
  sound_enabled: true,
  desktop_notification: false,
  push_enabled: false,
  kakao_alimtalk: false,
}

const SERVICE_TYPE_OPTIONS = ["퍼블릭", "셔츠", "하퍼"] as const
const TAG_OPTIONS = ["새방", "안본인원", "초이스가능", "1빵", "인사안함", "긴급"] as const
const STAFF_ROLES = ["hostess", "staff"] as const

export default function StaffBoardPage() {
  const router = useRouter()
  const profile = useCurrentProfile()
  const [items, setItems] = useState<BoardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"need" | "available">("need")
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [respondTo, setRespondTo] = useState<BoardItem | null>(null)
  const [prevIds, setPrevIds] = useState<Set<string>>(new Set())

  // role guard — staff/hostess 차단
  const isStaffRole = profile?.role && (STAFF_ROLES as readonly string[]).includes(profile.role)
  useEffect(() => {
    if (profile && isStaffRole) {
      router.replace("/me/home")
    }
  }, [profile, isStaffRole, router])

  const loadBoard = useCallback(async () => {
    try {
      const res = await apiFetch("/api/staff-board")
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      const d = await res.json()
      if (!res.ok) {
        setError(d.message || "로드 실패")
        return
      }
      const newItems = (d.items as BoardItem[]) ?? []
      setItems(newItems)
      setError("")

      // 새로 추가된 카드 감지 → 알림
      const newIds = new Set(newItems.map((i) => i.id))
      const added = newItems.filter((i) => !prevIds.has(i.id) && !i.is_mine)
      if (prevIds.size > 0 && added.length > 0 && prefs.board_new_request) {
        playSound(prefs.sound_enabled)
        showDesktopNotif(prefs.desktop_notification, added.length)
      }
      setPrevIds(newIds)
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
    // prevIds intentionally excluded — closure 갱신은 매 호출마다 setState 로 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, prefs])

  const loadPrefs = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notifications/preferences")
      if (res.ok) {
        const d = await res.json()
        if (d.preferences) setPrefs({ ...DEFAULT_PREFS, ...d.preferences })
      }
    } catch { /* default 유지 */ }
  }, [])

  useEffect(() => {
    if (!profile || isStaffRole) return
    void loadPrefs()
    void loadBoard()
    // 10초 polling, visibility-aware
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      void loadBoard()
    }, 10_000)
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadBoard()
      }
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [profile, isStaffRole, loadBoard, loadPrefs])

  async function togglePref(key: keyof Preferences) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next) // optimistic
    try {
      await apiFetch("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ [key]: next[key] }),
      })
      // desktop notification 켤 때 권한 요청
      if (key === "desktop_notification" && next[key] && typeof Notification !== "undefined") {
        if (Notification.permission === "default") {
          await Notification.requestPermission()
        }
      }
    } catch {
      setPrefs(prefs) // rollback
    }
  }

  async function cancelMine(id: string) {
    if (!confirm("이 카드를 취소하시겠습니까?")) return
    try {
      const res = await apiFetch(`/api/staff-board/${id}`, { method: "DELETE" })
      if (res.ok) await loadBoard()
      else {
        const d = await res.json().catch(() => ({}))
        alert(d.message || "취소 실패")
      }
    } catch {
      alert("네트워크 오류")
    }
  }

  const myCards = useMemo(
    () => items.filter((i) => i.is_mine),
    [items],
  )
  const visibleItems = useMemo(
    () => items.filter((i) => i.request_kind === tab),
    [items, tab],
  )

  if (profile === null || profile === undefined) {
    return <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center text-sm">로딩 중...</div>
  }
  if (isStaffRole) {
    return <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center text-sm">스태프 home 으로 이동 중...</div>
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📋 스태프 보드</span>
        <button
          onClick={() => { setEditingId(null); setEditorOpen(true) }}
          className="text-cyan-400 text-sm"
        >+ 등록</button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{error}</div>
      )}

      {/* 알림 설정 — 컴팩트한 toggle 모음 */}
      <div className="mx-4 mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-300">🔔 알림 설정</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <ToggleRow label="새 요청 알림" value={prefs.board_new_request} onChange={() => togglePref("board_new_request")} />
          <ToggleRow label="응답 알림" value={prefs.board_response} onChange={() => togglePref("board_response")} />
          <ToggleRow label="소리" value={prefs.sound_enabled} onChange={() => togglePref("sound_enabled")} />
          <ToggleRow label="데스크톱 팝업" value={prefs.desktop_notification} onChange={() => togglePref("desktop_notification")} />
        </div>
      </div>

      {/* 본인 매장 카드 */}
      {myCards.length > 0 && (
        <div className="mx-4 mt-3 space-y-2">
          <div className="text-xs text-slate-400">우리 매장</div>
          {myCards.map((c) => (
            <BoardCard
              key={c.id}
              item={c}
              onEdit={() => { setEditingId(c.id); setEditorOpen(true) }}
              onCancel={() => cancelMine(c.id)}
            />
          ))}
        </div>
      )}

      {/* 탭 — need / available */}
      <div className="mx-4 mt-4 flex items-center gap-2 text-xs">
        <button
          onClick={() => setTab("need")}
          className={`px-3 py-1.5 rounded-lg ${tab === "need" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}
        >🔴 요청 (need)</button>
        <button
          onClick={() => setTab("available")}
          className={`px-3 py-1.5 rounded-lg ${tab === "available" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}
        >🟢 가용 (available)</button>
      </div>

      <div className="mx-4 mt-3 space-y-2">
        {loading ? (
          <div className="text-xs text-slate-500 py-6 text-center">로딩 중...</div>
        ) : visibleItems.filter((i) => !i.is_mine).length === 0 ? (
          <div className="text-xs text-slate-500 py-6 text-center">
            {tab === "need" ? "현재 요청이 없습니다." : "현재 가용 카드가 없습니다."}
          </div>
        ) : (
          visibleItems.filter((i) => !i.is_mine).map((c) => (
            <BoardCard
              key={c.id}
              item={c}
              onRespond={() => setRespondTo(c)}
            />
          ))
        )}
      </div>

      {editorOpen && (
        <EditorModal
          editingId={editingId}
          onClose={() => { setEditorOpen(false); setEditingId(null) }}
          onSubmitted={async () => { setEditorOpen(false); setEditingId(null); await loadBoard() }}
          existingItems={items}
        />
      )}

      {respondTo && (
        <RespondModal
          target={respondTo}
          onClose={() => setRespondTo(null)}
          onSubmitted={async () => { setRespondTo(null); await loadBoard() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Sub components
// ─────────────────────────────────────────────

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`flex items-center justify-between px-3 py-2 rounded-lg border ${value ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-white/[0.03] text-slate-400"}`}
    >
      <span>{label}</span>
      <span className={`w-8 h-4 rounded-full relative transition-colors ${value ? "bg-cyan-500" : "bg-slate-600"}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${value ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  )
}

function BoardCard({ item, onEdit, onCancel, onRespond }: {
  item: BoardItem
  onEdit?: () => void
  onCancel?: () => void
  onRespond?: () => void
}) {
  const isNeed = item.request_kind === "need"
  // 2026-05-03: server-adjusted now — 매장간 보드 timing 일관.
  const nowMs = getServerNow()
  const ageMin = Math.max(0, Math.floor((nowMs - new Date(item.posted_at).getTime()) / 60000))
  const expMin = Math.max(0, Math.floor((new Date(item.expires_at).getTime() - nowMs) / 60000))

  return (
    <div className={`rounded-2xl border p-3 ${isNeed ? "border-cyan-500/20 bg-cyan-500/[0.05]" : "border-emerald-500/20 bg-emerald-500/[0.05]"} ${item.is_mine ? "ring-1 ring-fuchsia-500/30" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{item.store_label}</span>
            {item.is_mine && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-200">우리</span>}
            {item.update_count > 0 && <span className="text-[10px] text-slate-500">갱신 {item.update_count}회</span>}
          </div>
          <div className="text-sm mt-1.5">
            <span className={isNeed ? "text-cyan-300" : "text-emerald-300"}>
              {item.service_types.join(" · ") || "(종목 미지정)"}
            </span>
            <span className="text-slate-300"> · {item.party_size}인</span>
          </div>
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-300">{t}</span>
              ))}
            </div>
          )}
          {item.memo && (
            <div className="text-xs text-slate-400 mt-1.5">{item.memo}</div>
          )}
          <div className="text-[10px] text-slate-500 mt-2 flex items-center gap-3">
            <span>{ageMin}분 전</span>
            <span>{expMin}분 남음</span>
            {item.response_count > 0 && <span className="text-amber-300">응답 {item.response_count}건</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {item.is_mine ? (
            <>
              {onEdit && <button onClick={onEdit} className="text-[11px] px-2 py-1 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10">편집</button>}
              {onCancel && <button onClick={onCancel} className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10">취소</button>}
            </>
          ) : (
            onRespond && <button onClick={onRespond} className="text-[11px] px-2.5 py-1 rounded border border-white/20 text-slate-200 hover:bg-white/5">응답</button>
          )}
        </div>
      </div>
    </div>
  )
}

function EditorModal({ editingId, onClose, onSubmitted, existingItems }: {
  editingId: string | null
  onClose: () => void
  onSubmitted: () => Promise<void>
  existingItems: BoardItem[]
}) {
  const editing = editingId ? existingItems.find((i) => i.id === editingId) : null
  const [kind, setKind] = useState<"need" | "available">(editing?.request_kind ?? "need")
  const [services, setServices] = useState<string[]>(editing?.service_types ?? [])
  const [partySize, setPartySize] = useState<number>(editing?.party_size ?? 2)
  const [tags, setTags] = useState<string[]>(editing?.tags ?? [])
  const [memo, setMemo] = useState<string>(editing?.memo ?? "")
  const [submitting, setSubmitting] = useState(false)

  function toggleArr(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
  }

  async function submit() {
    if (services.length === 0) {
      alert("종목을 1개 이상 선택하세요.")
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/staff-board", {
        method: "POST",
        body: JSON.stringify({
          request_kind: kind,
          service_types: services,
          party_size: partySize,
          tags,
          memo: memo.trim() || null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(d.message || "저장 실패")
        return
      }
      await onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#0a0c14] border border-white/10 rounded-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">{editing ? "카드 편집" : "카드 등록"}</span>
          <button onClick={onClose} className="text-slate-400 text-sm">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-400 mb-1.5">종류</div>
            <div className="flex gap-2">
              <button
                onClick={() => setKind("need")}
                className={`flex-1 py-2 text-xs rounded-lg ${kind === "need" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}
              >🔴 요청 (스태프 부족)</button>
              <button
                onClick={() => setKind("available")}
                className={`flex-1 py-2 text-xs rounded-lg ${kind === "available" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}
              >🟢 가용 (보낼 수 있음)</button>
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">종목 (다중)</div>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_TYPE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setServices(toggleArr(services, s))}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${services.includes(s) ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" : "bg-white/5 text-slate-300 border-white/10"}`}
                >{s}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">손님 인원</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPartySize(Math.max(1, partySize - 1))} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10">−</button>
              <span className="text-xl font-bold text-cyan-300 w-12 text-center">{partySize}</span>
              <button onClick={() => setPartySize(Math.min(20, partySize + 1))} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10">+</button>
              <span className="text-xs text-slate-500 ml-1">인</span>
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">태그 (다중)</div>
            <div className="flex flex-wrap gap-1.5">
              {TAG_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTags(toggleArr(tags, t))}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${tags.includes(t) ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40" : "bg-white/5 text-slate-300 border-white/10"}`}
                >{t}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">메모 (선택, 200자)</div>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={200}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm placeholder-slate-500 outline-none focus:border-cyan-500/50"
              placeholder="예: 사이즈 좀 봐 주세요"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2 text-sm rounded-lg border border-white/10 text-slate-300">닫기</button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2 text-sm rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 disabled:opacity-50"
            >{submitting ? "저장 중..." : editing ? "갱신" : "등록"}</button>
          </div>

          <div className="text-[10px] text-slate-500 text-center">
            등록 시 15분 자동 만료. 운영 중 갱신하면 만료 시간 초기화.
          </div>
        </div>
      </div>
    </div>
  )
}

function RespondModal({ target, onClose, onSubmitted }: {
  target: BoardItem
  onClose: () => void
  onSubmitted: () => Promise<void>
}) {
  const [kind, setKind] = useState<"confirm" | "question" | "decline">("confirm")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/staff-board/${target.id}/respond`, {
        method: "POST",
        body: JSON.stringify({ response_kind: kind, message: message.trim() || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(d.message || "응답 실패")
        return
      }
      await onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#0a0c14] border border-white/10 rounded-2xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">응답</span>
          <button onClick={onClose} className="text-slate-400 text-sm">✕</button>
        </div>
        <div className="text-xs text-slate-400 mb-3">
          → {target.store_label} · {target.service_types.join(" · ")} · {target.party_size}인
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <button onClick={() => setKind("confirm")} className={`py-2 text-xs rounded-lg ${kind === "confirm" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}>확인</button>
          <button onClick={() => setKind("question")} className={`py-2 text-xs rounded-lg ${kind === "question" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}>질문</button>
          <button onClick={() => setKind("decline")} className={`py-2 text-xs rounded-lg ${kind === "decline" ? "bg-red-500/20 text-red-300 border border-red-500/40" : "bg-white/5 text-slate-400 border border-white/10"}`}>거절</button>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="메시지 (선택)"
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm placeholder-slate-500 outline-none focus:border-cyan-500/50 mb-3"
        />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm rounded-lg border border-white/10 text-slate-300">닫기</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2 text-sm rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 disabled:opacity-50"
          >{submitting ? "전송 중..." : "전송"}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Notification helpers — sound + desktop popup
// ─────────────────────────────────────────────

function playSound(enabled: boolean) {
  if (!enabled) return
  if (typeof window === "undefined") return
  try {
    // 간단한 beep — 외부 오디오 파일 없이 Web Audio API 로 생성.
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch { /* silent */ }
}

function showDesktopNotif(enabled: boolean, count: number) {
  if (!enabled) return
  if (typeof Notification === "undefined") return
  if (Notification.permission !== "granted") return
  try {
    new Notification("NOX 스태프 보드", {
      body: `새 카드 ${count}건`,
      icon: "/favicon.png",
    })
  } catch { /* silent */ }
}
