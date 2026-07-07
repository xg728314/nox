"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

const TAGS = ["착한", "장타", "팁많음", "인사x", "무한날개", "사이즈만", "블랙"]

export default function NewGuestPage() {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [memo, setMemo] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const r = await apiFetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name.trim(),
          phone: phone.trim() || undefined,
          tags: [...tags],
          memo: memo.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.message ?? "실패")
      toast("손님 등록", "success")
      router.push(`/m/guests/${j.id}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-white">
      <PageHeader title="새 손님 등록" backHref="/m/guests" />

      <div className="px-5 pb-24 space-y-4 pt-2">
        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">
            표시명 (익명 가능)
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 50대 사장님 / 김다미형 / 이름"
            className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-bold outline-none"
            autoFocus
          />
        </div>

        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">전화 (선택)</div>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[13px] outline-none"
          />
        </div>

        <div>
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">태그</div>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  const n = new Set(tags)
                  if (n.has(t)) n.delete(t)
                  else n.add(t)
                  setTags(n)
                }}
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
          <div className="text-[11px] font-extrabold text-[#7A746A] mb-1.5">메모</div>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="취향, 특징, 조심할 점 등"
            rows={4}
            className="w-full bg-[#FAF5EC] border border-[#D8D2C8] rounded-xl px-4 py-3 text-[13px] outline-none resize-none"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-2xl py-3.5 text-[13px] font-extrabold disabled:opacity-40"
        >
          {busy ? "등록 중..." : "손님 등록"}
        </button>
      </div>
    </div>
  )
}
