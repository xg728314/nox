"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

const CATEGORIES = ["퍼블릭", "하퍼", "셔츠"]
const TAGS = ["땁(안본)", "본인원", "새방", "장타", "팁방", "꿀방", "착한", "사이즈만", "인사x", "일행추가"]

export default function NewWaitingPage() {
  const router = useRouter()
  const toast = useToast()
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [guestCount, setGuestCount] = useState("")
  const [roomCount, setRoomCount] = useState("1")
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [guestNote, setGuestNote] = useState("")
  const [busy, setBusy] = useState(false)

  function toggleSet(s: Set<string>, v: string, setter: (n: Set<string>) => void) {
    const n = new Set(s)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    setter(n)
  }

  async function submit() {
    if (busy) return
    if (cats.size === 0) {
      toast("종목 1개 이상 선택", "error")
      return
    }
    setBusy(true)
    try {
      const r = await apiFetch("/api/waiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: [...cats],
          guest_count: guestCount ? parseInt(guestCount, 10) : undefined,
          room_count: roomCount ? parseInt(roomCount, 10) : undefined,
          tags: [...tags].map((t) => t.replace(/\(.+\)/, "")),
          guest_note: guestNote.trim() || undefined,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.message ?? "HTTP " + r.status)
      }
      toast("대기 요청 등록", "success")
      router.push("/m/waiting")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-white">
      <PageHeader title="새 대기 요청" backHref="/m/waiting" />

      <div className="px-5 pb-24 space-y-4 pt-2">
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">종목 (복수 선택)</div>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleSet(cats, c, setCats)}
                className={`py-2.5 rounded-xl text-[12px] font-extrabold border ${
                  cats.has(c)
                    ? "bg-[#C49B61] text-white border-[#A87D45]"
                    : "bg-white border-[#D8D2C8] text-[#7A746A]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">인원</div>
            <input
              type="number"
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
              placeholder="3"
              className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-bold outline-none"
            />
          </div>
          <div>
            <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">방 개수</div>
            <input
              type="number"
              value={roomCount}
              onChange={(e) => setRoomCount(e.target.value)}
              placeholder="1"
              className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-bold outline-none"
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">태그</div>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleSet(tags, t, setTags)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold border ${
                  tags.has(t)
                    ? "bg-[#2D2B26] text-white border-[#2D2B26]"
                    : "bg-white border-[#D8D2C8] text-[#7A746A]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">손님 정보 (선택)</div>
          <textarea
            value={guestNote}
            onChange={(e) => setGuestNote(e.target.value)}
            placeholder="예: 50대 사장님 · 오늘 생일 · 김다미 닮은 언니 원함"
            rows={3}
            className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[13px] outline-none resize-none"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy || cats.size === 0}
          className="w-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-2xl py-3.5 text-[13px] font-extrabold disabled:opacity-40"
        >
          {busy ? "등록 중..." : "대기 요청 올리기 (15분 유효)"}
        </button>
      </div>
    </div>
  )
}
