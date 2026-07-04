"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

const CATEGORIES = ["텐쩜오", "룸싸롱", "퍼블릭", "하이퍼블릭", "호스트", "기타"]
const REGIONS = ["서울", "부산", "인천", "대구", "대전", "광주", "울산", "경기"]

export default function NewAdPage() {
  const router = useRouter()
  const toast = useToast()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [category, setCategory] = useState("텐쩜오")
  const [regionTop, setRegionTop] = useState("서울")
  const [regionSub, setRegionSub] = useState("")
  const [tcAmount, setTcAmount] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactKakao, setContactKakao] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    if (!title.trim()) {
      toast("제목 필수", "error")
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          category,
          region_top: regionTop,
          region_sub: regionSub.trim() || undefined,
          tc_amount: tcAmount ? parseInt(tcAmount, 10) : undefined,
          contact_phone: contactPhone.trim() || undefined,
          contact_kakao: contactKakao.trim() || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast("광고 등록", "success")
      router.push(`/m/jobs/${j.id}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-white">
      <PageHeader title="새 광고 등록" backHref="/m/jobs" />

      <div className="px-5 pb-24 space-y-4 pt-2">
        <Field label="제목">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 강남 텐카페 초보 언니 모집 · 1시간 30만"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none"
          />
        </Field>

        <Field label="종목">
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`py-2.5 rounded-xl text-[12px] font-extrabold border ${
                  category === c
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-gray-700 border-gray-200"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="지역 (시/도)">
            <select
              value={regionTop}
              onChange={(e) => setRegionTop(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-[13px] outline-none"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="세부 (구/동)">
            <input
              type="text"
              value={regionSub}
              onChange={(e) => setRegionSub(e.target.value)}
              placeholder="강남구"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none"
            />
          </Field>
        </div>

        <Field label="티씨 (만원)">
          <input
            type="number"
            value={tcAmount}
            onChange={(e) => setTcAmount(e.target.value)}
            placeholder="20"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none"
          />
        </Field>

        <Field label="본문">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="근무 조건, 시간, 특이사항 등"
            rows={6}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none resize-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="연락처">
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="010-0000-0000"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none"
            />
          </Field>
          <Field label="카카오 ID">
            <input
              type="text"
              value={contactKakao}
              onChange={(e) => setContactKakao(e.target.value)}
              placeholder="kakao_id"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[13px] outline-none"
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy || !title.trim()}
          className="w-full bg-gradient-to-br from-orange-500 to-pink-500 text-white rounded-2xl py-3.5 text-[13px] font-extrabold disabled:opacity-40 mt-4"
        >
          {busy ? "등록 중..." : "광고 등록"}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-extrabold text-gray-700 mb-1.5">{label}</div>
      {children}
    </div>
  )
}
