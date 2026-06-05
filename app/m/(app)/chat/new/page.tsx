"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { useBuildingHostesses } from "../../../_hooks/useMobileData"
import { useToast } from "../../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../_lib/cn"

export default function ChatNewPage() {
  const router = useRouter()
  const toast = useToast()
  const { data, isLoading } = useBuildingHostesses()
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const list = (data?.hostesses ?? []).filter((h) =>
    q.trim() ? (h.hostess_name ?? "").toLowerCase().includes(q.trim().toLowerCase()) : true,
  )

  async function submit() {
    if (selected.size === 0 || !title.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "group",
          title: title.trim(),
          participant_membership_ids: Array.from(selected),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      toast("채팅방 생성됨", "success")
      router.push(`/m/chat/${encodeURIComponent(j.id)}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="새 채팅방" backHref="/m/chat" />
      <div className="px-5 pb-32 flex flex-col gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="방 이름"
          className="bg-white border border-[#D8D2C8] rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#C49B61]"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="참여자 검색 (이름)"
          className="bg-white border border-[#D8D2C8] rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#C49B61]"
        />
        <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider px-1">
          참여자 {selected.size}명 선택됨
        </div>
        <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden max-h-[380px] overflow-y-auto">
          {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
          {list.length === 0 && !isLoading && (
            <div className="text-center text-[12px] text-[#7A746A] py-6">{q ? "검색 결과 없음" : "사람이 없습니다"}</div>
          )}
          {list.map((h, i) => {
            const sel = selected.has(h.membership_id)
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
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded-md border-2 flex items-center justify-center",
                    sel ? "bg-[#C49B61] border-transparent" : "border-[#D8D2C8]",
                  )}
                >
                  {sel && <span className="text-white text-[10px] font-extrabold">✓</span>}
                </div>
                <div className="flex-1 text-[12px] font-bold truncate">{h.hostess_name}</div>
                <div className="text-[10px] font-semibold text-[#7A746A]">
                  {h.store_name}
                  {h.floor != null && ` · ${h.floor}F`}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#D8D2C8]/60 px-5 py-3"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={submit}
          disabled={selected.size === 0 || !title.trim() || submitting}
          className="w-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
        >
          {submitting ? "생성 중..." : `${selected.size}명 그룹 채팅 만들기`}
        </button>
      </div>
    </div>
  )
}
