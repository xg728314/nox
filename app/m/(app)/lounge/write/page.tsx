"use client"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

const BOARDS = [
  { slug: "free", label: "자유 수다" },
  { slug: "promo", label: "홍보·이벤트" },
  { slug: "corporate", label: "기업" },
  { slug: "life", label: "생정·이슈" },
]

export default function LoungeWritePage() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const initialBoard = params?.get("board") ?? "free"
  const [board, setBoard] = useState(initialBoard)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    if (!title.trim() || !body.trim()) {
      toast("제목/내용 필수", "error")
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, title: title.trim(), body: body.trim() }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast("게시글 등록", "success")
      router.push(`/m/lounge/${j.id}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="새 게시글" backHref="/m/lounge" />

      <div className="px-4 pb-24 space-y-3 pt-2">
        <div>
          <div className="text-[10px] font-extrabold text-white/60 mb-1.5 tracking-wider">
            게시판
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BOARDS.map((b) => (
              <button
                key={b.slug}
                type="button"
                onClick={() => setBoard(b.slug)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold border ${
                  board === b.slug
                    ? "bg-purple-500/30 border-purple-400 text-purple-100"
                    : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-[14px] font-bold outline-none placeholder:text-white/40"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="내용을 입력하세요"
          rows={10}
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-[13px] outline-none placeholder:text-white/40 resize-none"
        />

        <button
          type="button"
          onClick={submit}
          disabled={busy || !title.trim() || !body.trim()}
          className="w-full bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white rounded-2xl py-3 text-[13px] font-extrabold disabled:opacity-40 shadow-lg"
        >
          {busy ? "등록 중..." : "게시글 올리기"}
        </button>
      </div>
    </div>
  )
}
