"use client"
/**
 * ServiceCallSheet — 방 서비스 콜 (안주/술/담배/기타).
 *
 * R-svc-calls (2026-09-04): 카톡 "@담당실장 재떨이/담배/블투" 대체.
 * 방 상세에서 카테고리 선택 → 상세 입력 → 호출 → 웨이터 대시보드 실시간.
 */
import { useEffect, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

type SvcType = "menu"|"drink"|"smoke"|"temp"|"blanket"|"ashtray"|"mic"|"battery"|"water"|"other"

const OPTIONS: Array<{ key: SvcType; icon: string; label: string; hint?: string }> = [
  { key: "menu",    icon: "🍿", label: "안주",     hint: "예: 콤비네이션 씬피자 1 / 짜파게티 2" },
  { key: "drink",   icon: "🍺", label: "술",       hint: "예: 맥주 2병 / 소주 1병" },
  { key: "smoke",   icon: "🚬", label: "담배",     hint: "예: 딥브라운 1갑" },
  { key: "water",   icon: "💧", label: "물",       hint: "예: 컨디션스틱 · 물티슈 · 휴지" },
  { key: "temp",    icon: "❄️", label: "온도",     hint: "예: 24도로 낮춰주세요" },
  { key: "blanket", icon: "🛏", label: "담요",     hint: "" },
  { key: "ashtray", icon: "🗑", label: "재떨이",   hint: "예: 재떨이 2개 교체" },
  { key: "mic",     icon: "🎤", label: "블투/마이크", hint: "예: 블투 스피커 연결" },
  { key: "battery", icon: "🔋", label: "보조배터리", hint: "" },
  { key: "other",   icon: "✏️", label: "기타",     hint: "자유 입력" },
]

export function ServiceCallSheet({
  open, onClose, sessionId, roomLabel,
}: {
  open: boolean; onClose: () => void; sessionId: string; roomLabel: string
}) {
  const toast = useToast()
  const [picked, setPicked] = useState<SvcType | null>(null)
  const [detail, setDetail] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setPicked(null); setDetail("") }
  }, [open])

  const pickedOpt = picked ? OPTIONS.find(o => o.key === picked) : null

  async function submit() {
    if (busy || !picked) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/service-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          request_type: picked,
          detail: detail.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`🛎 ${roomLabel} ${pickedOpt?.label} 호출됨`, "success")
      invalidateApi("/api/service-calls")
      onClose()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            🛎 서비스 콜
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">{roomLabel}</div>
        </div>

        {/* 카테고리 그리드 */}
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {OPTIONS.map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => { setPicked(o.key); setDetail("") }}
              className={cn(
                "rounded-xl py-3 text-center border-2 transition-all",
                picked === o.key
                  ? "border-[#A87D45] bg-[#C49B61]/20"
                  : "border-[#D8D2C8] bg-white",
              )}
            >
              <div className="text-[16px] leading-none">{o.icon}</div>
              <div className="text-[9px] font-black text-[#2D2B26] mt-1">{o.label}</div>
            </button>
          ))}
        </div>

        {/* 상세 입력 */}
        {picked && (
          <div className="mb-3">
            <div className="text-[10px] font-extrabold text-[#7A746A] mb-1.5">
              상세 (선택) {pickedOpt?.hint && <span className="font-bold opacity-70">· {pickedOpt.hint}</span>}
            </div>
            <input
              type="text"
              value={detail}
              onChange={e => setDetail(e.target.value.slice(0, 200))}
              placeholder="예: 딥브라운 1갑 · 라이터 포함"
              className="w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-3 py-2 text-[12px] font-semibold text-[#2D2B26]"
              autoFocus
            />
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40">
            취소
          </button>
          <button type="button" onClick={submit} disabled={busy || !picked}
            className={cn("rounded-xl py-3 text-[13px] font-extrabold text-white transition-all",
              busy || !picked ? "bg-[#D8D2C8] opacity-70" : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] active:scale-[0.98]")}>
            {busy ? "호출 중..." : picked ? `🛎 ${pickedOpt?.label} 호출` : "카테고리 선택"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
