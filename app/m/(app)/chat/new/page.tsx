"use client"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { useBuildingHostesses, useMe } from "../../../_hooks/useMobileData"
import { useToast } from "../../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../_lib/cn"

export default function ChatNewPage() {
  const router = useRouter()
  const toast = useToast()
  const me = useMe()
  const { data, isLoading } = useBuildingHostesses()
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [showOtherStores, setShowOtherStores] = useState(false)

  // 백엔드는 본인 매장 멤버만 그룹 채팅 허용 (INVALID_MEMBERS 거부).
  //   디폴트는 본인 매장 멤버만, 토글로 전체 보기 가능 (시각 참고용 — 선택 시 경고).
  const myStoreUuid = me.data?.store_uuid
  const allHostesses = data?.hostesses ?? []
  const list = useMemo(() => {
    let arr = allHostesses
    if (!showOtherStores && myStoreUuid) {
      arr = arr.filter((h) => h.store_uuid === myStoreUuid)
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      arr = arr.filter((h) => (h.hostess_name ?? "").toLowerCase().includes(needle))
    }
    return arr
  }, [allHostesses, q, showOtherStores, myStoreUuid])

  // 선택한 멤버 중 본인 매장이 아닌 것 개수 — 백엔드 거부 가능성 경고용
  const crossStoreSelected = useMemo(() => {
    if (!myStoreUuid) return 0
    let count = 0
    for (const id of selected) {
      const h = allHostesses.find((x) => x.membership_id === id)
      if (h && h.store_uuid !== myStoreUuid) count++
    }
    return count
  }, [selected, allHostesses, myStoreUuid])

  const effectiveTitle = title.trim() || `${selected.size}명 그룹 채팅`
  const canSubmit = selected.size > 0 && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "group",
          name: effectiveTitle, // 백엔드는 'name' 필드 (chat_rooms.name).
          member_ids: Array.from(selected), // 백엔드는 'member_ids'.
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          j?.error === "INVALID_MEMBERS"
            ? "그룹 채팅은 같은 매장 멤버만 가능합니다. 다른 매장 멤버 선택을 해제해주세요."
            : j?.message || `HTTP ${res.status}`
        throw new Error(msg)
      }
      toast("채팅방 생성됨", "success")
      // 백엔드 응답: { chat_room_id, type, member_count }
      const newRoomId = j.chat_room_id || j.id
      if (newRoomId) {
        router.push(`/m/chat/${encodeURIComponent(newRoomId)}`)
      } else {
        router.push("/m/chat")
      }
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="새 채팅방" backHref="/m/chat" />
      <div className="px-5 pb-4 flex-1 flex flex-col gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`방 이름 (비우면 "${selected.size}명 그룹 채팅")`}
          className="bg-white border border-[#D8D2C8] rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#C49B61]"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="참여자 검색 (이름)"
          className="bg-white border border-[#D8D2C8] rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#C49B61]"
        />

        {/* 매장 범위 토글 + 안내 */}
        <div className="flex items-center justify-between px-1">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider">
            참여자 {selected.size}명 선택됨
            {crossStoreSelected > 0 && (
              <span className="ml-1.5 text-red-600 normal-case">
                ⚠ 타 매장 {crossStoreSelected}명 (생성 실패 가능)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowOtherStores((v) => !v)}
            className="text-[10px] font-bold text-[#A87D45] underline"
          >
            {showOtherStores ? "본인 매장만" : "전체 매장"}
          </button>
        </div>

        {!showOtherStores && (
          <div className="text-[10px] text-[#7A746A] font-semibold bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-snug">
            그룹 채팅은 <b>같은 매장</b> 멤버만 가능합니다. 다른 매장과는 메이드 카드 / 글로벌 채팅으로.
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden max-h-[380px] overflow-y-auto">
          {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
          {list.length === 0 && !isLoading && (
            <div className="text-center text-[12px] text-[#7A746A] py-6">{q ? "검색 결과 없음" : "사람이 없습니다"}</div>
          )}
          {list.map((h, i) => {
            const sel = selected.has(h.membership_id)
            const isOther = myStoreUuid != null && h.store_uuid !== myStoreUuid
            return (
              <button
                key={h.membership_id}
                type="button"
                onClick={() => {
                  setSelected((s) => {
                    const n = new Set(s)
                    if (n.has(h.membership_id)) n.delete(h.membership_id)
                    else n.add(h.membership_id)
                    return n
                  })
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 text-left",
                  i > 0 && "border-t border-[#D8D2C8]/40",
                  sel && "bg-[#C49B61]/10",
                  isOther && sel && "bg-red-50",
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded-md border-2 flex items-center justify-center",
                    sel
                      ? isOther
                        ? "bg-red-500 border-transparent"
                        : "bg-[#C49B61] border-transparent"
                      : "border-[#D8D2C8]",
                  )}
                >
                  {sel && <span className="text-white text-[10px] font-extrabold">✓</span>}
                </div>
                <div className="flex-1 text-[12px] font-bold truncate">{h.hostess_name}</div>
                <div className={cn("text-[10px] font-semibold", isOther ? "text-red-600" : "text-[#7A746A]")}>
                  {h.store_name}
                  {h.floor != null && ` · ${h.floor}F`}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div
        className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#D8D2C8]/60 px-5 py-3 z-10"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
        >
          {submitting
            ? "생성 중..."
            : selected.size === 0
              ? "참여자를 선택하세요"
              : `${effectiveTitle} (${selected.size}명) 만들기`}
        </button>
      </div>
    </div>
  )
}
