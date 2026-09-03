"use client"
/**
 * WaitlistCreateSheet — 대기 요청 등록.
 *
 * R-waitlist (2026-09-04): 카톡 "셔 3인 1빵 새방 안본인원 대기부탁드립니다"
 * 도배 대체. 카드 형태 통일 · 자동 dedup (같은 스펙 5분 내 갱신).
 */
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

type Category = "퍼블릭" | "하퍼" | "셔츠" | "any"
type SeenPolicy = "unseen_only" | "any"

const CATEGORIES: Array<{ key: Category; label: string; letter: string }> = [
  { key: "퍼블릭", label: "퍼블릭", letter: "P" },
  { key: "하퍼", label: "하퍼", letter: "H" },
  { key: "셔츠", label: "셔츠", letter: "S" },
  { key: "any", label: "종목무관", letter: "*" },
]
const TAG_PRESETS = ["착함", "매너", "장타", "노터치", "노술", "일본어", "젊잘", "개꿀방"]

export function WaitlistCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [category, setCategory] = useState<Category>("셔츠")
  const [partySize, setPartySize] = useState(2)
  const [roomCount, setRoomCount] = useState(1)
  const [isNewRoom, setIsNewRoom] = useState(true)
  const [seenPolicy, setSeenPolicy] = useState<SeenPolicy>("any")
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCategory("셔츠"); setPartySize(2); setRoomCount(1)
      setIsNewRoom(true); setSeenPolicy("any"); setTags([]); setNote("")
    }
  }, [open])

  async function submit() {
    if (busy) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, party_size: partySize, room_count: roomCount,
          is_new_room: isNewRoom, seen_policy: seenPolicy,
          tags, note: note.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(j.dedup ? "기존 대기 갱신 (같은 스펙)" : "대기 등록", "success")
      invalidateApi("/api/waitlist")
      onClose()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  function toggleTag(t: string) {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            대기 등록
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">
            {category} · {partySize}인 · {roomCount}빵 · {isNewRoom ? "새방" : "체인지"}
          </div>
          <div className="mt-0.5 text-[10px] font-bold text-[#7A746A]">
            건물 5-8F 실장에게 15분간 노출 · 자동 만료
          </div>
        </div>

        {/* 종목 */}
        <div className="mb-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">종목</div>
          <div className="grid grid-cols-4 gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={cn(
                  "rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
                  category === c.key
                    ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26]"
                    : "border-[#D8D2C8] bg-white text-[#7A746A]",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 인원 · 빵수 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">인원</div>
            <div className="grid grid-cols-4 gap-1">
              {[2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setPartySize(n)}
                  className={cn("rounded-lg py-2 text-[12px] font-black border-2",
                    partySize === n ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {[6, 8, 10, 15].map(n => (
                <button key={n} type="button" onClick={() => setPartySize(n)}
                  className={cn("rounded-lg py-2 text-[11px] font-black border-2",
                    partySize === n ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">빵수</div>
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3].map(n => (
                <button key={n} type="button" onClick={() => setRoomCount(n)}
                  className={cn("rounded-lg py-2 text-[12px] font-black border-2",
                    roomCount === n ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                  {n}빵
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 새방 · 본인원 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">방 유형</div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={() => setIsNewRoom(true)}
                className={cn("rounded-lg py-2 text-[11px] font-black border-2",
                  isNewRoom ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                새방
              </button>
              <button type="button" onClick={() => setIsNewRoom(false)}
                className={cn("rounded-lg py-2 text-[11px] font-black border-2",
                  !isNewRoom ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                체인지
              </button>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">본인원</div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={() => setSeenPolicy("any")}
                className={cn("rounded-lg py-2 text-[11px] font-black border-2",
                  seenPolicy === "any" ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                상관없음
              </button>
              <button type="button" onClick={() => setSeenPolicy("unseen_only")}
                className={cn("rounded-lg py-2 text-[11px] font-black border-2",
                  seenPolicy === "unseen_only" ? "border-[#A87D45] bg-[#C49B61]/20" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                안본만
              </button>
            </div>
          </div>
        </div>

        {/* 태그 */}
        <div className="mb-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">특성 태그</div>
          <div className="flex flex-wrap gap-1.5">
            {TAG_PRESETS.map(t => (
              <button key={t} type="button" onClick={() => toggleTag(t)}
                className={cn("rounded-full px-2.5 py-1 text-[10px] font-black border",
                  tags.includes(t) ? "border-[#A87D45] bg-[#C49B61]/20 text-[#8C6A3A]" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
                {tags.includes(t) ? "✓ " : ""}{t}
              </button>
            ))}
          </div>
        </div>

        {/* 메모 */}
        <div className="mb-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">메모 (선택)</div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 100))}
            placeholder="예: 젊고 잘생긴 손님 · 사이즈 보고 매치"
            className="w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-3 py-2 text-[12px] font-semibold text-[#2D2B26]"
          />
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40">
            취소
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className={cn("rounded-xl py-3 text-[13px] font-extrabold text-white transition-all",
              busy ? "bg-[#D8D2C8] opacity-70" : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] active:scale-[0.98]")}>
            {busy ? "등록 중..." : "📋 대기 등록"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
