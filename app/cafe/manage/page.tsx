"use client"

/**
 * /cafe/manage — 카페 owner 홈. CafeManageProvider 의 bootstrap 데이터 사용.
 *   직접 fetch 없음 → 사이드바와 polling 1회 공유.
 */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCafeManage } from "@/components/cafe/CafeManageContext"

function fmt(n: number) { return "₩" + n.toLocaleString() }

export default function CafeManageHome() {
  const router = useRouter()
  const { data, loading, error } = useCafeManage()

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  if (loading && !data) {
    return <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
  }
  if (!data) return <div className="p-10 text-center text-red-400">{error || "데이터 로드 실패"}</div>

  const profile = data.profile
  const inbox = data.inbox
  const credits = data.credits_unpaid
  const chatUnread = data.chat_unread

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">카페 관리</div>
            <div className="text-xl font-semibold mt-0.5">☕ {profile.store_name ?? "—"}</div>
            {profile.floor && <div className="text-[11px] text-slate-500 mt-0.5">{profile.floor}F</div>}
          </div>
          <button onClick={logout}
            className="text-xs px-3 py-1.5 rounded bg-white/[0.04] border border-white/10 text-slate-400">로그아웃</button>
        </div>

        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {/* 진행 중 주문 요약 */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
          <div className="text-xs text-slate-400">현재 진행 중</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-2xl font-bold text-amber-300">{inbox.pending}</div>
              <div className="text-[11px] text-slate-400">주문</div>
            </div>
            <div className="rounded-lg bg-cyan-500/10 p-3">
              <div className="text-2xl font-bold text-cyan-300">{inbox.preparing}</div>
              <div className="text-[11px] text-slate-400">준비중</div>
            </div>
            <div className="rounded-lg bg-blue-500/10 p-3">
              <div className="text-2xl font-bold text-blue-300">{inbox.delivering}</div>
              <div className="text-[11px] text-slate-400">배달중</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-white/5">
            <span className="text-slate-400">오늘 주문</span>
            <span className="tabular-nums">{inbox.today_count} 건 · {fmt(inbox.today_gross)}</span>
          </div>
        </div>

        {credits.count > 0 && (
          <Link href="/cafe/manage/credits"
            className="block rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-3 hover:bg-red-500/10 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-red-200">⚠️ 외상 미결제 {credits.count}건</div>
                <div className="text-[11px] text-slate-400 mt-0.5">합계 {fmt(credits.total)}</div>
              </div>
              <span className="text-xs text-red-300">관리 →</span>
            </div>
          </Link>
        )}

        {/* 핵심 메뉴 4개 */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/cafe/manage/inbox"
            className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 hover:bg-emerald-500/10 transition-colors">
            <div className="text-2xl mb-1">📋</div>
            <div className="text-sm font-semibold text-emerald-200">주문 받기</div>
            <div className="text-[11px] text-slate-400 mt-0.5">진행 중 + 신규</div>
          </Link>
          <Link href="/cafe/manage/menu"
            className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 hover:bg-cyan-500/10 transition-colors">
            <div className="text-2xl mb-1">📋</div>
            <div className="text-sm font-semibold text-cyan-200">메뉴등록</div>
            <div className="text-[11px] text-slate-400 mt-0.5">상품/가격/레시피</div>
          </Link>
          <Link href="/cafe/manage/finance"
            className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 hover:bg-purple-500/10 transition-colors">
            <div className="text-2xl mb-1">💰</div>
            <div className="text-sm font-semibold text-purple-200">재무</div>
            <div className="text-[11px] text-slate-400 mt-0.5">매출 / 결제수단</div>
          </Link>
          <Link href="/chat"
            className="rounded-2xl border border-pink-500/20 bg-pink-500/5 p-4 hover:bg-pink-500/10 transition-colors relative">
            {chatUnread > 0 && (
              <span className="absolute top-3 right-3 text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{chatUnread}</span>
            )}
            <div className="text-2xl mb-1">💬</div>
            <div className="text-sm font-semibold text-pink-200">채팅</div>
            <div className="text-[11px] text-slate-400 mt-0.5">단체 + 1:1 DM</div>
          </Link>
        </div>

        <Link href="/cafe/manage/store"
          className="block rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 hover:bg-orange-500/10 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl mb-1">📦</div>
              <div className="text-sm font-semibold text-orange-200">매장관리</div>
              <div className="text-[11px] text-slate-400 mt-0.5">소모품 (컵/빨대/원두) · 입고 · 자동차감</div>
            </div>
            <span className="text-xs text-orange-300">→</span>
          </div>
        </Link>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link href="/cafe/manage/pos"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08] transition-colors">
            <div className="text-sm">🖨️ POS 출력</div>
            <div className="text-[11px] text-slate-500 mt-0.5">자동 영수증</div>
          </Link>
          <Link href="/cafe/manage/credits"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08] transition-colors relative">
            {credits.count > 0 && (
              <span className="absolute top-3 right-3 text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{credits.count}</span>
            )}
            <div className="text-sm">📒 외상 관리</div>
            <div className="text-[11px] text-slate-500 mt-0.5">미결제 추적</div>
          </Link>
          <Link href="/cafe/manage/account"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08] transition-colors">
            <div className="text-sm">🏦 계좌 등록</div>
            <div className="text-[11px] text-slate-500 mt-0.5">입금 결제용</div>
          </Link>
          <Link href={`/cafe/${profile.store_uuid}`}
            className="rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08] transition-colors">
            <div className="text-sm">👀 미리보기</div>
            <div className="text-[11px] text-slate-500 mt-0.5">고객 시점</div>
          </Link>
        </div>
      </div>
    </div>
  )
}
