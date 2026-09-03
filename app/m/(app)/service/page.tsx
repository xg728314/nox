"use client"
/**
 * /m/service — 방 서비스 콜 대시보드 (웨이터/카운터/실장)
 *
 * R-svc-calls (2026-09-04): 카톡 "@담당실장 재떨이" 대체.
 * - 대기 콜 카드 실시간 목록
 * - 접수 (in_progress) → 완료 (done)
 * - 완료 이력 하단
 */
import { useMemo, useState } from "react"
import { useServiceCalls, type ServiceCall } from "../../_hooks/useMobileData"
import { useToast } from "../../_components/Toast"
import { invalidateApi } from "../../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../_lib/cn"

const TYPE_META: Record<string, { icon: string; label: string }> = {
  menu:    { icon: "🍿", label: "안주" },
  drink:   { icon: "🍺", label: "술" },
  smoke:   { icon: "🚬", label: "담배" },
  water:   { icon: "💧", label: "물/기타" },
  temp:    { icon: "❄️", label: "온도" },
  blanket: { icon: "🛏", label: "담요" },
  ashtray: { icon: "🗑", label: "재떨이" },
  mic:     { icon: "🎤", label: "블투" },
  battery: { icon: "🔋", label: "배터리" },
  other:   { icon: "✏️", label: "기타" },
}

function fmtSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  if (m < 1) return `${s}초전`
  if (m < 60) return `${m}분전`
  return `${Math.floor(m / 60)}시간 ${m % 60}분전`
}

export default function ServicePage() {
  const active = useServiceCalls("active")
  const done = useServiceCalls("done")
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function patch(id: string, status: "in_progress" | "done" | "cancelled") {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await apiFetch(`/api/service-calls/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast(status === "done" ? "완료" : status === "in_progress" ? "접수" : "취소", "success")
      invalidateApi("/api/service-calls")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  const requested = (active.data?.items ?? []).filter(c => c.status === "requested")
  const progress = (active.data?.items ?? []).filter(c => c.status === "in_progress")
  const recent = (done.data?.items ?? []).slice(0, 10)

  return (
    <div className="min-h-dvh bg-[#F5F0E5] pb-24">
      <div className="sticky top-0 z-10 bg-[#F5F0E5]/95 backdrop-blur border-b border-[#EDE7DA] px-4 pt-4 pb-3">
        <div className="text-[14px] font-extrabold text-[#2D2B26]">🛎 서비스 콜</div>
        <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
          대기 {requested.length} · 진행 {progress.length} · 오늘 완료 {recent.length}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-3">
        {requested.length > 0 && (
          <section>
            <div className="text-[11px] font-black text-yellow-800 mb-1.5 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"/>
              대기 · {requested.length}건
            </div>
            <div className="space-y-2">
              {requested.map(c => (
                <ServiceCallCard key={c.id} call={c} busy={busyId === c.id}
                  onAction={s => patch(c.id, s)} />
              ))}
            </div>
          </section>
        )}

        {progress.length > 0 && (
          <section>
            <div className="text-[11px] font-black text-orange-800 mb-1.5">진행 중 · {progress.length}건</div>
            <div className="space-y-2">
              {progress.map(c => (
                <ServiceCallCard key={c.id} call={c} busy={busyId === c.id}
                  onAction={s => patch(c.id, s)} />
              ))}
            </div>
          </section>
        )}

        {requested.length === 0 && progress.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-white/60 px-4 py-8 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">🎉 대기 없음</div>
            <div className="mt-1 text-[10px] text-[#7A746A]/70">방 상세에서 「🛎 콜」 눌러 요청</div>
          </div>
        )}

        {recent.length > 0 && (
          <section>
            <div className="text-[11px] font-black text-[#7A746A] mb-1.5 pt-2 border-t border-[#EDE7DA]">
              최근 완료
            </div>
            <div className="space-y-1">
              {recent.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-[10px] text-[#7A746A] px-2 py-1">
                  <span className="text-[14px]">{TYPE_META[c.request_type]?.icon}</span>
                  <span className="font-black">{c.room_no ?? "?"}번방</span>
                  <span>{TYPE_META[c.request_type]?.label}</span>
                  {c.detail && <span className="italic truncate flex-1">· {c.detail}</span>}
                  <span className="text-[9px] opacity-70 shrink-0">
                    {c.completed_at ? fmtSince(c.completed_at) : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ServiceCallCard({ call, busy, onAction }: {
  call: ServiceCall; busy: boolean; onAction: (s: "in_progress"|"done"|"cancelled") => void
}) {
  const meta = TYPE_META[call.request_type] ?? TYPE_META.other
  const isProgress = call.status === "in_progress"
  return (
    <div className={cn("rounded-2xl border-2 px-3 py-2.5 shadow-sm",
      isProgress ? "border-orange-400 bg-orange-50" : "border-yellow-400 bg-yellow-50")}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[24px] leading-none">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-extrabold text-[#2D2B26]">
            {call.room_no ? `${call.room_no}번방` : "방 미지정"} · {meta.label}
          </div>
          {call.detail && (
            <div className="text-[11px] font-semibold text-[#5A544A] truncate">{call.detail}</div>
          )}
        </div>
        <div className="text-[9px] font-bold text-[#7A746A] text-right shrink-0">
          {fmtSince(call.created_at)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mt-2">
        {call.status === "requested" && (
          <button type="button" disabled={busy} onClick={() => onAction("in_progress")}
            className="col-span-2 rounded-lg bg-orange-500 text-white py-2 text-[11px] font-black disabled:opacity-40">
            {busy ? "..." : "🙋 접수"}
          </button>
        )}
        {call.status === "in_progress" && (
          <button type="button" disabled={busy} onClick={() => onAction("done")}
            className="col-span-2 rounded-lg bg-green-500 text-white py-2 text-[11px] font-black disabled:opacity-40">
            {busy ? "..." : "✓ 완료"}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onAction("cancelled")}
          className="rounded-lg border-2 border-[#D8D2C8] bg-white py-2 text-[10px] font-black text-[#7A746A] disabled:opacity-40">
          취소
        </button>
      </div>
    </div>
  )
}
