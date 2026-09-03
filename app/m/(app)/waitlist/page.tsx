"use client"
/**
 * /m/waitlist — 매장 대기 board
 *
 * R-waitlist (2026-09-04): 카톡 대기 도배 대체.
 * - 상단: 등록 버튼
 * - 필터: 전체 / 우리 매장 / 종목별
 * - 카드: 매장 · 종목 · 인원 · 빵 · 새방 · 태그 · 만료 카운트
 * - 다른 매장 카드 → 「매칭 제안」 (임시: alert · 다음 라운드 cross-store dispatch 연결)
 * - 본 매장 카드 → 취소 / 완료
 */
import { useMemo, useState } from "react"
import { WaitlistCreateSheet } from "../../_components/WaitlistCreateSheet"
import { useWaitlist, type WaitlistItem } from "../../_hooks/useMobileData"
import { useToast } from "../../_components/Toast"
import { invalidateApi } from "../../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../_lib/cn"

type Filter = "all" | "mine" | "퍼블릭" | "하퍼" | "셔츠"

function fmtRemain(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "만료"
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, "0")}`
}

function fmtElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분전`
  return `${Math.floor(m / 60)}시간 전`
}

export default function WaitlistPage() {
  const wl = useWaitlist("building")
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const items = wl.data?.items ?? []
  const filtered = useMemo(() => {
    if (filter === "all") return items
    if (filter === "mine") return items.filter(i => i.is_mine)
    return items.filter(i => i.category === filter)
  }, [items, filter])

  const mineCount = items.filter(i => i.is_mine).length
  const buildingCount = items.length - mineCount

  async function patch(id: string, status: "matched" | "cancelled") {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await apiFetch(`/api/waitlist/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast(status === "matched" ? "매칭 완료" : "취소됨", "success")
      invalidateApi("/api/waitlist")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-dvh bg-[#F5F0E5] pb-24">
      <div className="sticky top-0 z-10 bg-[#F5F0E5]/95 backdrop-blur border-b border-[#EDE7DA] px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-extrabold text-[#2D2B26]">📋 대기 board</div>
            <div className="text-[10px] font-bold text-[#7A746A]">
              전체 {items.length} · 우리 {mineCount} · 다른 매장 {buildingCount}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-[11px] font-black px-4 py-2 shadow-md active:scale-[0.98]"
          >
            + 대기 등록
          </button>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto -mx-1 px-1">
          {(["all", "mine", "퍼블릭", "하퍼", "셔츠"] as Filter[]).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cn("shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black border-2",
                filter === f ? "border-[#A87D45] bg-[#2D2B26] text-white" : "border-[#D8D2C8] bg-white text-[#7A746A]")}>
              {f === "all" ? "전체" : f === "mine" ? "우리 매장" : f}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-2">
        {wl.isLoading && (
          <div className="text-[11px] font-bold text-[#7A746A] py-6 text-center">로드중...</div>
        )}
        {!wl.isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-white/60 px-4 py-8 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">대기 요청 없음</div>
            <div className="mt-1 text-[10px] text-[#7A746A]/70">「대기 등록」 눌러 카톡 대신 여기 등록</div>
          </div>
        )}
        {filtered.map(it => (
          <WaitlistCard
            key={it.id}
            item={it}
            busy={busyId === it.id}
            onMatch={() => patch(it.id, "matched")}
            onCancel={() => patch(it.id, "cancelled")}
          />
        ))}
      </div>

      {createOpen && (
        <WaitlistCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  )
}

function WaitlistCard({ item, busy, onMatch, onCancel }: {
  item: WaitlistItem; busy: boolean; onMatch: () => void; onCancel: () => void
}) {
  const remain = fmtRemain(item.expires_at)
  const elapsed = fmtElapsed(item.created_at)
  const catColor =
    item.category === "퍼블릭" ? "bg-[#6B8AFD]/18 text-[#3E5EDB]"
    : item.category === "하퍼" ? "bg-[#D97757]/18 text-[#A94B2A]"
    : item.category === "셔츠" ? "bg-[#D9A557]/22 text-[#8C6A2A]"
    : "bg-[#7A746A]/15 text-[#2D2B26]"

  return (
    <div className={cn(
      "rounded-2xl border-2 px-3 py-2.5 shadow-sm",
      item.is_mine ? "border-[#A87D45] bg-[#FAF5EC]" : "border-[#EDE7DA] bg-white",
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] font-black bg-[#2D2B26] text-white rounded px-1.5 py-0.5 shrink-0">
            {item.store_name}
          </span>
          {item.floor != null && (
            <span className="text-[9px] font-bold text-[#7A746A]">{item.floor}F</span>
          )}
          {item.is_mine && (
            <span className="text-[9px] font-black bg-[#A87D45]/20 text-[#8C6A3A] rounded px-1 py-0.5">우리</span>
          )}
        </div>
        <div className="text-[9px] font-bold text-[#7A746A] shrink-0">
          {elapsed} · 만료 {remain}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("text-[11px] font-black rounded-md px-2 py-0.5", catColor)}>
          {item.category === "any" ? "종목무관" : item.category}
        </span>
        <span className="text-[12px] font-extrabold text-[#2D2B26]">{item.party_size}인 · {item.room_count}빵</span>
        <span className="text-[10px] font-bold text-[#7A746A]">{item.is_new_room ? "새방" : "체인지"}</span>
        {item.seen_policy === "unseen_only" && (
          <span className="text-[9px] font-black bg-red-100 text-red-700 rounded px-1.5 py-0.5">안본만</span>
        )}
      </div>

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {item.tags.map(t => (
            <span key={t} className="text-[9px] font-bold text-[#8C6A3A] bg-[#C49B61]/15 rounded-full px-1.5 py-0.5">
              #{t}
            </span>
          ))}
        </div>
      )}
      {item.note && (
        <div className="text-[10px] font-semibold text-[#5A544A] mb-1.5 italic">💬 {item.note}</div>
      )}

      <div className="flex gap-1.5 mt-2">
        {item.is_mine ? (
          <>
            <button type="button" disabled={busy} onClick={onCancel}
              className="flex-1 rounded-lg border-2 border-[#D8D2C8] bg-white py-1.5 text-[10px] font-black text-[#7A746A] disabled:opacity-40">
              ✕ 취소
            </button>
            <button type="button" disabled={busy} onClick={onMatch}
              className="flex-1 rounded-lg bg-gradient-to-br from-green-500 to-green-600 text-white py-1.5 text-[10px] font-black disabled:opacity-40">
              {busy ? "..." : "✓ 매칭 완료"}
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={onMatch}
            className="flex-1 rounded-lg bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white py-2 text-[11px] font-black disabled:opacity-40">
            {busy ? "..." : "🎯 매칭 제안"}
          </button>
        )}
      </div>
    </div>
  )
}
