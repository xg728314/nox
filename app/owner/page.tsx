"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { usePagePerf } from "@/lib/debug/usePagePerf"

type StoreProfile = {
  store_uuid: string
  store_name: string
  created_at: string
  role: string
  membership_status: string
}

type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
  status: string
}

type SettlementOverview = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
}

type StoreMembership = {
  membership_id: string
  store_uuid: string
  store_name: string
  role: string
  is_primary: boolean
}

export default function OwnerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [overview, setOverview] = useState<SettlementOverview[]>([])
  const [memberships, setMemberships] = useState<StoreMembership[]>([])
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)

  const me = useCurrentProfile()
  const currentStoreUuid = me?.store_uuid ?? ""

  usePagePerf("owner")

  useEffect(() => {
    // Bootstrap-first: single fan-in call, fall back to legacy fetches per slot.
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/owner/bootstrap")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) { router.push("/login"); return }
        if (!res.ok) {
          fetchAll()
          fetchMemberships()
          fetchChatUnread()
          return
        }
        const data = await res.json()
        const missing: string[] = []

        if (data.profile) setProfile(data.profile as StoreProfile)
        else missing.push("profile")

        if (Array.isArray(data.staff)) setStaff(data.staff as StaffMember[])
        else missing.push("staff")

        if (Array.isArray(data.overview)) setOverview(data.overview as SettlementOverview[])
        else missing.push("overview")

        if (Array.isArray(data.memberships)) setMemberships(data.memberships as StoreMembership[])
        else missing.push("memberships")

        if (typeof data.chat_unread === "number") setChatUnread(data.chat_unread)
        else missing.push("chat_unread")

        const needAll = missing.includes("profile") || missing.includes("staff") || missing.includes("overview")
        if (needAll) fetchAll()
        else setLoading(false)
        if (missing.includes("memberships")) fetchMemberships()
        if (missing.includes("chat_unread")) fetchChatUnread()
      } catch {
        if (cancelled) return
        fetchAll()
        fetchMemberships()
        fetchChatUnread()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchChatUnread() {
    try {
      const res = await apiFetch("/api/chat/unread")
      if (res.ok) {
        const data = await res.json()
        setChatUnread(data.unread_count ?? 0)
      }
    } catch { /* ignore */ }
  }

  async function fetchAll() {
    try {
      const [profileRes, staffRes, overviewRes] = await Promise.all([
        apiFetch("/api/store/profile"),
        apiFetch("/api/store/staff"),
        apiFetch("/api/store/settlement/overview"),
      ])

      if (profileRes.status === 401 || profileRes.status === 403) { router.push("/login"); return }

      if (profileRes.ok) {
        const data = await profileRes.json()
        setProfile(data)
      }

      if (staffRes.ok) {
        const data = await staffRes.json()
        setStaff(data.staff ?? [])
      }

      if (overviewRes.ok) {
        const data = await overviewRes.json()
        setOverview(data.overview ?? [])
      }

      if (!profileRes.ok && !staffRes.ok && !overviewRes.ok) {
        setError("데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function fetchMemberships() {
    try {
      const res = await apiFetch("/api/auth/memberships")
      if (res.ok) {
        const data = await res.json()
        setMemberships(data.memberships ?? [])
      }
    } catch { /* ignore */ }
  }

  async function handleSwitchStore(m: StoreMembership) {
    // SECURITY (R-1 remediation): store_uuid/role cannot be stored client-side
    // anymore — they live in the HttpOnly session. The server needs to be
    // told which membership the caller wants to act as; we call a dedicated
    // switch endpoint if it exists, otherwise instruct the operator to
    // re-login with the target membership. (TODO: wire a proper
    // /api/auth/switch-membership endpoint.)
    setSwitching(true)
    try {
      // Fall back to a full logout + login round-trip to change scope.
      await apiFetch("/api/auth/logout", { method: "POST" })
    } finally {
      router.push("/login")
    }
  }

  const otherStores = memberships.filter((m) => m.store_uuid !== currentStoreUuid)

  const managerCount = staff.filter((s) => s.role === "manager").length
  const hostessCount = staff.filter((s) => s.role === "hostess").length
  const finalizedCount = overview.filter((o) => o.status === "finalized").length
  const draftCount = overview.filter((o) => o.status === "draft").length
  const noneCount = overview.filter((o) => !o.has_settlement).length

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 카운터</button>
          <span className="font-semibold">매장관리</span>
          <div className="text-xs text-slate-400">사장</div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 매장 정보 */}
          {profile ? (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
              <div className="text-xs text-slate-400">매장 정보</div>
              <div className="text-lg font-semibold text-cyan-300">{profile.store_name}</div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>UUID: {profile.store_uuid.slice(0, 8)}</span>
                <span>가입: {new Date(profile.created_at).toLocaleDateString("ko-KR")}</span>
              </div>
            </div>
          ) : !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">매장 정보를 불러올 수 없습니다.</p>
            </div>
          )}

          {/* 매장 전환 */}
          {otherStores.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setShowSwitcher(!showSwitcher)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 flex items-center justify-between hover:bg-white/[0.08] transition-colors"
              >
                <span className="text-sm text-slate-300">다른 매장으로 전환</span>
                <span className="text-xs text-slate-500">{otherStores.length}개 매장 ▾</span>
              </button>
              {showSwitcher && (
                <div className="space-y-2">
                  {otherStores.map((m) => (
                    <button
                      key={m.store_uuid}
                      onClick={() => handleSwitchStore(m)}
                      disabled={switching}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-between hover:bg-cyan-500/10 hover:border-cyan-500/20 transition-colors disabled:opacity-50"
                    >
                      <div className="text-left">
                        <div className="text-sm font-medium text-slate-200">{m.store_name}</div>
                        <div className="text-xs text-slate-500">UUID: {m.store_uuid.slice(0, 8)} · {m.role === "owner" ? "사장" : m.role === "manager" ? "실장" : "스태프"}</div>
                      </div>
                      <span className="text-xs text-cyan-400">{switching ? "전환 중..." : "전환 →"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 회원 관리 섹션 — members-UI restructure round에서 분리.
              회원 생성 (privileged role) / 가입 승인 (hostess only) /
              계정 관리 (전체 role) 3개 페이지로 완전히 분할. 각 액션은
              별도 페이지에서 한 화면 한 동작으로 처리. */}
          <div className="mt-4 mb-2 text-xs uppercase tracking-wider text-cyan-300/70">
            회원 관리
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "회원 생성", path: "/admin/members/create", icon: "➕" },
              { label: "가입 승인", path: "/admin/approvals", icon: "✅" },
              { label: "계정 관리", path: "/admin/members", icon: "👥" },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-left hover:bg-cyan-400/10 transition-colors"
              >
                <div className="text-xl mb-1">{item.icon}</div>
                <div className="text-xs text-slate-300">{item.label}</div>
              </button>
            ))}
          </div>

          {/* 빠른 이동 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "관제", path: "/admin", icon: "📡" },
              { label: "리포트", path: "/reports", icon: "📊" },
              { label: "카운터", path: "/counter", icon: "🖥️" },
              { label: "배정", path: "/attendance", icon: "📋" },
              { label: "감사 로그", path: "/audit", icon: "📜" },
              { label: "정산 현황", path: "/owner/settlement", icon: "💰" },
              { label: "지급 관리", path: "/payouts", icon: "💸" },
              { label: "정산 이력", path: "/settlement/history", icon: "📒" },
              { label: "외상 관리", path: "/credits", icon: "📝" },
              { label: "이적 관리", path: "/transfer", icon: "🔄" },
              { label: "재고", path: "/inventory", icon: "📦" },
              { label: "채팅", path: "/chat", icon: "💬" },
              { label: "운영 설정", path: "/ops", icon: "⚙️" },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08] transition-colors relative"
              >
                <div className="text-xl mb-2">{item.icon}</div>
                {item.label === "채팅" && chatUnread > 0 && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
                <div className="text-sm font-medium text-slate-200">{item.label}</div>
              </button>
            ))}
          </div>

          {/* 스태프 현황 */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">스태프 현황</span>
              <span className="text-xs text-slate-500">{staff.length}명</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-blue-500/10 p-3">
                <div className="text-xs text-slate-400">실장</div>
                <div className="mt-1 text-2xl font-semibold text-blue-300">{managerCount}</div>
              </div>
              <div className="rounded-xl bg-purple-500/10 p-3">
                <div className="text-xs text-slate-400">스태프</div>
                <div className="mt-1 text-2xl font-semibold text-purple-300">{hostessCount}</div>
              </div>
            </div>

            {staff.length === 0 && !error && (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">등록된 스태프가 없습니다.</p>
              </div>
            )}

            {staff.length > 0 && (
              <div className="space-y-2">
                {staff.map((s) => (
                  <div key={s.membership_id} className="flex items-center justify-between py-2 border-t border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                        s.role === "manager" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"
                      }`}>
                        {(s.name || "?").slice(0, 1)}
                      </div>
                      <div>
                        <div className="text-sm">{s.name}</div>
                        <div className="text-xs text-slate-500">{s.role === "manager" ? "실장" : "스태프"}</div>
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                      {s.status === "approved" ? "승인" : s.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 정산 개요 */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">정산 개요</span>
              <span className="text-xs text-slate-500">{overview.length}명</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <div className="text-xs text-slate-400">확정</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-300">{finalizedCount}</div>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3">
                <div className="text-xs text-slate-400">대기</div>
                <div className="mt-1 text-2xl font-semibold text-amber-300">{draftCount}</div>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3">
                <div className="text-xs text-slate-400">없음</div>
                <div className="mt-1 text-2xl font-semibold text-slate-400">{noneCount}</div>
              </div>
            </div>

            {overview.length === 0 && !error && (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">정산 데이터가 없습니다.</p>
              </div>
            )}

            {overview.length > 0 && (
              <div className="space-y-2">
                {overview.map((o) => (
                  <div key={o.hostess_id} className="flex items-center justify-between py-2 border-t border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                        o.has_settlement
                          ? o.status === "finalized"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                      }`}>
                        {o.has_settlement ? (o.status === "finalized" ? "✓" : "◷") : "−"}
                      </div>
                      <div>
                        <div className="text-sm">{o.hostess_name || o.hostess_id.slice(0, 8)}</div>
                        <div className="text-xs text-slate-500">
                          {o.has_settlement
                            ? o.status === "finalized" ? "정산 확정" : "정산 대기"
                            : "정산 없음"}
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === "finalized"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : o.status === "draft"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                    }`}>
                      {o.status === "finalized" ? "확정" : o.status === "draft" ? "대기" : "없음"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
