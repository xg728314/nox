"use client"
/**
 * /m/store/settings/chat-parser — 봇 엄격도 · 매장 채팅 규칙 편집.
 *
 * R36 (2026-09-09): owner 만 · STORE_SETTINGS 위임된 실장도 접근 가능.
 */
import { useEffect, useState } from "react"
import { PageHeader } from "../../../../_components/PageHeader"
import { TabBar } from "../../../../_components/TabBar"
import { useToast } from "../../../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../../_lib/cn"

type Strictness = "friendly" | "standard" | "strict" | "silent"

const OPTIONS: Array<{ value: Strictness; icon: string; label: string; desc: string; color: string }> = [
  { value: "friendly", icon: "🤗", label: "친절 (Friendly)", desc: "못 알아들으면 매번 정중히 안내 · 도입 초기 권장", color: "border-green-400 bg-green-50 text-green-900" },
  { value: "standard", icon: "🎯", label: "표준 (Standard)", desc: "명확한 오류만 안내 · 애매한 건 조용히 학습", color: "border-blue-400 bg-blue-50 text-blue-900" },
  { value: "strict",   icon: "🛡", label: "엄격 (Strict)",   desc: "규칙 위반만 짧게 지적 · 자동 등록 최소", color: "border-amber-400 bg-amber-50 text-amber-900" },
  { value: "silent",   icon: "🔇", label: "침묵 (Silent)",   desc: "봇 완전 침묵 · 로그만 남김", color: "border-[#D8D2C8] bg-white text-[#7A746A]" },
]

export default function ChatParserSettingsPage() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [strictness, setStrictness] = useState<Strictness>("friendly")
  const [rules, setRules] = useState<{ prefix_required?: boolean; examples?: string[] } | null>(null)
  const [draftExamples, setDraftExamples] = useState<string>("")

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/store/chat-strictness")
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setStrictness((j.strictness as Strictness) ?? "friendly")
      setRules(j.rules ?? null)
      setDraftExamples((j.rules?.examples ?? []).join("\n"))
    } catch (e) {
      toast(`로드 실패: ${(e as Error).message}`, "error")
    } finally {
      setLoading(false)
    }
  }

  async function saveStrictness(next: Strictness) {
    if (saving) return
    setSaving(true)
    try {
      const res = await apiFetch("/api/store/chat-strictness", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strictness: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setStrictness(next)
      toast(`엄격도 변경: ${OPTIONS.find(o => o.value === next)?.label}`, "success")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function saveRules() {
    if (saving) return
    setSaving(true)
    try {
      const exs = draftExamples.split("\n").map(l => l.trim()).filter(Boolean)
      const next = { ...(rules ?? {}), examples: exs, prefix_required: rules?.prefix_required !== false }
      const res = await apiFetch("/api/store/chat-strictness", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setRules(next)
      toast("규칙 저장", "success")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#F5F0E5] pb-24">
      <PageHeader title="채팅 봇 · 규칙 설정" backHref="/m/store/settings" />

      <div className="px-4 pt-4 space-y-4">
        {loading && <div className="text-center text-[12px] text-[#7A746A] py-6">로드중...</div>}

        {!loading && (
          <>
            {/* 엄격도 4단계 */}
            <section className="rounded-2xl bg-white border border-[#D8D2C8] p-4">
              <div className="text-[11px] font-black text-[#7A746A] uppercase tracking-wider mb-2">
                🤖 봇 엄격도
              </div>
              <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed mb-3">
                채팅 파싱 실패 시 봇이 얼마나 개입할지 정합니다.
                도입 초기엔 「친절」, 정착 후엔 「표준」 권장.
              </div>
              <div className="space-y-2">
                {OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    onClick={() => void saveStrictness(opt.value)}
                    className={cn(
                      "w-full text-left rounded-xl border-2 p-3 transition-all",
                      strictness === opt.value ? `${opt.color} shadow-sm` : "border-[#EDE7DA] bg-[#FAF5EC]/40 text-[#7A746A]",
                      saving && "opacity-40 cursor-wait",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[18px]">{opt.icon}</span>
                      <span className="text-[13px] font-extrabold flex-1">{opt.label}</span>
                      {strictness === opt.value && <span className="text-[11px] font-black">✓ 선택됨</span>}
                    </div>
                    <div className="text-[10px] font-bold mt-1 opacity-80 leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* 규칙 예시 (배너 · 튜토리얼용) */}
            <section className="rounded-2xl bg-white border border-[#D8D2C8] p-4">
              <div className="text-[11px] font-black text-[#7A746A] uppercase tracking-wider mb-2">
                📝 매장 형식 예시
              </div>
              <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed mb-3">
                채팅방 상단 배너 · 신입 튜토리얼에 표시됩니다. 한 줄에 하나씩.
              </div>
              <textarea
                value={draftExamples}
                onChange={e => setDraftExamples(e.target.value)}
                rows={5}
                placeholder="「마블 지연 셔츠 완메」&#10;「마블 3번방 유나 하퍼 스타트」&#10;「마블 다은 반차3 끝」"
                className="w-full rounded-xl border-2 border-[#D8D2C8] bg-[#FAF5EC]/40 px-3 py-2 text-[12px] font-mono text-[#2D2B26] focus:border-[#C49B61] focus:outline-none"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveRules()}
                className="mt-2 w-full rounded-xl bg-[#C49B61] py-3 text-[12px] font-extrabold text-white active:bg-[#A87D45] disabled:opacity-40"
              >
                {saving ? "저장 중..." : "규칙 저장"}
              </button>
            </section>

            {/* 자동 억제 안내 */}
            <section className="rounded-2xl bg-[#FAF5EC] border border-[#EDE7DA] p-4">
              <div className="text-[11px] font-black text-[#8C6A3A] uppercase tracking-wider mb-2">
                🔇 봇 자동 억제 (기본 활성)
              </div>
              <ul className="text-[11px] font-bold text-[#7A746A] leading-relaxed space-y-1 pl-4 list-disc">
                <li>같은 사용자 같은 오류 <b>3회</b> 후 침묵</li>
                <li>피크 시간대 (21:00~03:00 KST) → 상세 답장 X · pill 만</li>
                <li>방 30초 내 봇 답장 <b>5회</b> 초과 시 rate limit</li>
                <li>「침묵」 모드 시 봇 완전 정지</li>
              </ul>
            </section>
          </>
        )}
      </div>

      <TabBar />
    </div>
  )
}
