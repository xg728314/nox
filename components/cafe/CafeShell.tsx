"use client"

/**
 * CafeShell — 카페 manage 공통 wrapper.
 *   - 모바일: children 만
 *   - PC: 왼쪽 DM 사이드바 + 가운데 children + 오른쪽 재고 알람
 *
 * 데이터는 CafeManageContext 의 단일 bootstrap 사용 (중복 fetch 제거).
 */

import Link from "next/link"
import type { ReactNode } from "react"
import { useCafeManage } from "./CafeManageContext"

export default function CafeShell({ children }: { children: ReactNode }) {
  const { data } = useCafeManage()
  const rooms = data?.chat_rooms ?? []
  const lowStock = data?.low_stock ?? []

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white">
      {/* PC */}
      <div className="hidden md:flex h-screen">
        <aside className="w-72 border-r border-white/10 bg-[#070a12] flex flex-col">
          <div className="p-3 border-b border-white/10">
            <Link href="/cafe/manage" className="text-sm font-bold flex items-center gap-2">
              <span>☕</span> 카페 관리
            </Link>
          </div>
          <div className="p-2 text-[11px] text-slate-400">
            💬 채팅 {data && data.chat_unread > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 rounded-full">{data.chat_unread}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {rooms.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">대화 없음</div>
            ) : (
              rooms.map((r) => (
                <Link
                  key={r.id}
                  href={`/chat/${r.id}`}
                  className="block px-3 py-2 hover:bg-white/[0.04] border-b border-white/5"
                >
                  <div className="text-sm font-medium truncate">
                    {r.type === "global" ? "🌐 단체" : r.type === "direct" ? "1:1 DM" : r.name || "채팅"}
                  </div>
                  {r.last_message_text && (
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">{r.last_message_text}</div>
                  )}
                </Link>
              ))
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">{children}</main>

        <aside className="w-72 border-l border-white/10 bg-[#070a12] p-3 overflow-y-auto">
          <div className="text-sm font-bold mb-2 flex items-center gap-2">
            <span>📦</span> 재고 알람
            {lowStock.length > 0 && (
              <span className="text-[10px] bg-red-500 text-white px-1.5 rounded-full">{lowStock.length}</span>
            )}
          </div>
          {lowStock.length === 0 ? (
            <div className="text-xs text-slate-500 mt-4 text-center">모든 소모품 정상</div>
          ) : (
            <div className="space-y-2">
              {lowStock.map((s) => (
                <div key={s.id} className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2.5">
                  <div className="text-sm font-semibold text-red-200">{s.name}</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    현재 <span className="text-red-300 font-bold">{s.current_stock}</span> / 최소 {s.min_stock} {s.unit}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 외상 알람 */}
          {data && data.credits_unpaid.count > 0 && (
            <Link href="/cafe/manage/credits"
              className="block mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 hover:bg-amber-500/10">
              <div className="text-sm font-semibold text-amber-200">📒 외상 미결제 {data.credits_unpaid.count}</div>
              <div className="text-[11px] text-amber-300 mt-1">합계 ₩{data.credits_unpaid.total.toLocaleString()}</div>
            </Link>
          )}

          <Link href="/cafe/manage/store"
            className="block mt-3 text-center text-xs px-3 py-2 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-200">
            매장관리 →
          </Link>
        </aside>
      </div>

      {/* 모바일 */}
      <div className="md:hidden">{children}</div>
    </div>
  )
}
