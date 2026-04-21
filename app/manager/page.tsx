"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type DashboardData = {
  assigned_hostess_count: number
  assigned_hostesses_preview: { hostess_id: string; hostess_name: string }[]
  visible_sections: string[]
}

type Hostess = {
  hostess_id: string
  hostess_name: string
}

type SettlementSummary = {
  total_sessions: number
  total_gross: number
  total_manager_amount: number
}

type AttendanceRecord = {
  id: string
  membership_id: string
  role: string
  status: string
  name: string
  room_name: string | null
}

type ManagedParticipant = {
  id: string
  session_id: string
  external_name: string | null
  category: string | null
  time_minutes: number | null
  entered_at: string
  match_status: "matched" | "unmatched"
  name_edited: boolean
  room_name: string | null
  working_store_name: string | null
}

export default function ManagerPage() {
  const router = useRouter()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [hostesses, setHostesses] = useState<Hostess[]>([])
  const [settlement, setSettlement] = useState<SettlementSummary | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [managedParticipants, setManagedParticipants] = useState<ManagedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [chatUnread, setChatUnread] = useState(0)
  const [showProfitToOwner, setShowProfitToOwner] = useState(false)
  const [showHostessProfitToOwner, setShowHostessProfitToOwner] = useState(false)
  const [visibilityLoading, setVisibilityLoading] = useState(false)

  useEffect(() => {
    fetchData()
    fetchChatUnread()
    fetchManagedParticipants()
    fetchVisibility()
  }, [])

  async function fetchVisibility() {
    try {
      const res = await apiFetch("/api/manager/visibility")
      if (res.ok) {
        const data = await res.json()
        setShowProfitToOwner(data.show_profit_to_owner ?? false)
        setShowHostessProfitToOwner(data.show_hostess_profit_to_owner ?? false)
      }
    } catch { /* ignore */ }
  }

  async function toggleVisibility(field: "show_profit_to_owner" | "show_hostess_profit_to_owner", value: boolean) {
    setVisibilityLoading(true)
    try {
      const res = await apiFetch("/api/manager/visibility", {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const data = await res.json()
        setShowProfitToOwner(data.show_profit_to_owner)
        setShowHostessProfitToOwner(data.show_hostess_profit_to_owner)
      }
    } catch { /* ignore */ }
    setVisibilityLoading(false)
  }

  async function fetchManagedParticipants() {
    try {
      const res = await apiFetch("/api/manager/participants")
      if (res.ok) {
        const data = await res.json()
        setManagedParticipants(data.participants ?? [])
      }
    } catch { /* ignore */ }
  }

  async function handleParticipantNameEdit(participantId: string, currentName: string | null, newName: string) {
    const val = newName.trim()
    if (val === (currentName ?? "").trim()) return
    try {
      const res = await apiFetch(`/api/sessions/participants/${participantId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "update_external_name", external_name: val }),
      })
      if (res.ok) {
        // 갱신
        await fetchManagedParticipants()
      }
    } catch { /* ignore */ }
  }

  async function fetchChatUnread() {
    try {
      const res = await apiFetch("/api/chat/unread")
      if (res.ok) {
        const data = await res.json()
        setChatUnread(data.unread_count ?? 0)
      }
    } catch { /* ignore */ }
  }

  async function fetchData() {
    try {
      const [dashRes, hostessRes, settleRes, attendRes] = await Promise.all([
        apiFetch("/api/manager/dashboard"),
        apiFetch("/api/manager/hostesses"),
        apiFetch("/api/manager/settlement/summary"),
        apiFetch("/api/attendance"),
      ])

      if (dashRes.status === 401 || dashRes.status === 403) {
        router.push("/login")
        return
      }

      if (dashRes.ok) {
        const data = await dashRes.json()
        setDashboard({
          assigned_hostess_count: data.assigned_hostess_count ?? 0,
          assigned_hostesses_preview: data.assigned_hostesses_preview ?? [],
          visible_sections: data.visible_sections ?? [],
        })
      }

      if (hostessRes.ok) {
        const data = await hostessRes.json()
        setHostesses(data.hostesses ?? [])
      }

      if (settleRes.ok) {
        const data = await settleRes.json()
        setSettlement({
          total_sessions: data.total_sessions ?? 0,
          total_gross: data.gross_total ?? 0,
          total_manager_amount: data.manager_amount ?? 0,
        })
      }

      if (attendRes.ok) {
        const data = await attendRes.json()
        setAttendance((data.attendance ?? []).filter((a: AttendanceRecord) => a.status !== "off_duty"))
      }
    } catch {
      setError("데이터를 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

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
          <span className="text-lg font-semibold">매니저 대시보드</span>
          <button
            onClick={async () => {
              try { await apiFetch("/api/auth/logout", { method: "POST" }) } catch { /* ignore */ }
              // Defence-in-depth: clear any residual client-side auth keys
              // from prior (pre-R-1-fix) sessions. Real auth lives in the
              // HttpOnly cookie which the logout endpoint already cleared.
              try {
                localStorage.removeItem("access_token")
                localStorage.removeItem("role")
                localStorage.removeItem("store_uuid")
                localStorage.removeItem("user_id")
                localStorage.removeItem("membership_id")
              } catch { /* ignore */ }
              router.push("/login")
            }}
            className="text-xs text-slate-400 hover:text-white"
          >
            로그아웃
          </button>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 요약 카드 */}
        <div className="px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="text-xs text-slate-400">담당 스태프</div>
              <div className="mt-1 text-3xl font-semibold text-cyan-300">
                {dashboard?.assigned_hostess_count ?? 0}
                <span className="text-base text-slate-400">명</span>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-xs text-slate-400">출근 현황</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-300">
                {attendance.length}
                <span className="text-base text-slate-400">명</span>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs text-slate-400">오늘 세션</div>
              <div className="mt-1 text-3xl font-semibold text-amber-300">
                {settlement?.total_sessions ?? 0}
                <span className="text-base text-slate-400">건</span>
              </div>
            </div>
            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="text-xs text-slate-400">실장 수익</div>
              <div className="mt-1 text-xl font-semibold text-purple-300">
                {((settlement?.total_manager_amount ?? 0) / 10000).toFixed(0)}
                <span className="text-base text-slate-400">만원</span>
              </div>
            </div>
          </div>
        </div>

        {/* 사장 열람 권한 설정 */}
        <div className="px-4 mb-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-medium text-slate-300 mb-3">사장 열람 권한</div>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-slate-400">실장 수익 공개</span>
                <button
                  disabled={visibilityLoading}
                  onClick={() => toggleVisibility("show_profit_to_owner", !showProfitToOwner)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${showProfitToOwner ? "bg-cyan-500" : "bg-slate-600"} ${visibilityLoading ? "opacity-50" : ""}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${showProfitToOwner ? "translate-x-5" : ""}`} />
                </button>
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-slate-400">스태프 수익 공개</span>
                <button
                  disabled={visibilityLoading}
                  onClick={() => toggleVisibility("show_hostess_profit_to_owner", !showHostessProfitToOwner)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${showHostessProfitToOwner ? "bg-cyan-500" : "bg-slate-600"} ${visibilityLoading ? "opacity-50" : ""}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${showHostessProfitToOwner ? "translate-x-5" : ""}`} />
                </button>
              </label>
            </div>
            <p className="text-[11px] text-slate-600 mt-2">ON 시 사장님이 해당 수익을 볼 수 있습니다.</p>
          </div>
        </div>

        {/* 진행 중 참여자 — 매칭 상태 */}
        {managedParticipants.length > 0 && (
          <div className="px-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-300">진행 중 참여자</span>
              <span className="text-xs text-slate-500">{managedParticipants.length}명</span>
            </div>

            {(() => {
              const unmatched = managedParticipants.filter(p => p.match_status === "unmatched")
              const matched = managedParticipants.filter(p => p.match_status === "matched")
              return (
                <>
                  {unmatched.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] text-red-400 font-semibold mb-2">매칭 실패 · 수정 바람 ({unmatched.length})</div>
                      <div className="space-y-1.5">
                        {unmatched.map(p => (
                          <div key={p.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[8px] bg-red-500/80 text-white px-1 rounded font-bold">매칭실패</span>
                              {p.name_edited && <span className="text-[8px] bg-slate-500/60 text-slate-200 px-1 rounded">수정됨</span>}
                              <span className="text-[10px] text-slate-500 ml-auto">{p.working_store_name} · {p.room_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                key={`mgr-name-${p.id}-${p.external_name ?? ""}`}
                                type="text"
                                defaultValue={p.external_name ?? ""}
                                placeholder="이름 입력"
                                onBlur={e => handleParticipantNameEdit(p.id, p.external_name, e.target.value)}
                                className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40"
                              />
                              <span className="text-[10px] text-slate-500 flex-shrink-0">{p.category}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {matched.length > 0 && (
                    <div>
                      <div className="text-[11px] text-emerald-400 font-semibold mb-2">매칭 완료 ({matched.length})</div>
                      <div className="space-y-1">
                        {matched.map(p => (
                          <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 flex items-center gap-2">
                            <span className="text-sm text-white font-medium flex-1">{p.external_name || "?"}</span>
                            {p.name_edited && <span className="text-[8px] bg-slate-500/60 text-slate-200 px-1 rounded">수정됨</span>}
                            <span className="text-[10px] text-slate-500">{p.working_store_name} · {p.room_name}</span>
                            <span className="text-[10px] text-slate-500">{p.category}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* 스태프 목록 */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-300">담당 스태프 목록</span>
            <span className="text-xs text-slate-500">{hostesses.length}명</span>
          </div>

          {hostesses.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">👤</div>
              <p className="text-slate-500 text-sm">담당 스태프가 없습니다.</p>
            </div>
          )}

          <div className="space-y-2">
            {hostesses.map((h) => (
              <div key={h.hostess_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/20 flex items-center justify-center text-sm text-purple-300">
                    {(h.hostess_name || "?").slice(0, 1)}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{h.hostess_name || h.hostess_id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{h.hostess_id.slice(0, 8)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 하단 네비 */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
        {/* OPS(`/ops`)는 owner 전용(middleware OWNER_ONLY_PREFIXES)이라
            manager가 눌러도 307로 튕긴다. 이 라운드에서 manager 네비에서는
            제거해 진입 흐름 불일치를 해소한다. 나머지(/attendance /payouts
            /credits)는 OWNER_MANAGER_PREFIXES 그룹으로 이동되어 통과된다. */}
        <div className="grid grid-cols-7 py-2">
          {[
            { label: "카운터", icon: "⊞", path: "/counter" },
            { label: "배정", icon: "📋", path: "/attendance" },
            { label: "정산", icon: "💰", path: "/manager/settlement" },
            { label: "지급", icon: "💸", path: "/payouts" },
            { label: "외상", icon: "📝", path: "/credits" },
            { label: "채팅", icon: "💬", path: "/chat" },
            { label: "내 정보", icon: "👤", path: "/me" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => router.push(item.path)}
              className={`flex flex-col items-center py-2 gap-1 text-xs relative ${item.path === "/manager" ? "text-cyan-400" : "text-slate-500"}`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
              {item.label === "채팅" && chatUnread > 0 && (
                <span className="absolute top-0.5 right-1 bg-red-500 text-white text-[10px] px-1 py-0 rounded-full min-w-[16px] text-center leading-4">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
