"use client"

/**
 * /me/home — 스태프 (hostess) 전용 대시보드.
 *
 * 운영자 의도 (2026-05-01):
 *   "스태프는 내가 들어간 방 외에는 보이면 안 되고
 *    내가 들어간 방에 채팅창 / 친구찾아 DM / 내가 일한 갯수 만 나와야 한다."
 *
 * 구성 (4 카드):
 *   1. 내 방 (active session) — 방 번호 / 종목 / 경과 시간 / 담당 실장
 *      - active 없으면 "현재 들어간 방 없음" placeholder
 *   2. 내가 일한 갯수 — 오늘 / 이번 달
 *   3. 채팅 — 미읽음 카운트 + /chat 진입
 *   4. DM — 직원 검색 + DM 시작 (내 방 매니저, 동료)
 *
 * 정책:
 *   - server (/api/me/home) 에서 본인 시점 데이터만 받음. 다른 방 / 다른
 *     직원 세션 정보는 내려오지 않음 (스코프 보안).
 *   - role 가드: hostess / staff / waiter 외 다른 role 도 본 페이지 접근
 *     가능 (본인 시점). owner / manager 는 자기 dashboard 가 별도라
 *     middleware 가 redirect 안 하지만 본 페이지 자체는 본인 정보 표시.
 */

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { useServerClock } from "@/lib/time/serverClock"

type ActiveSession = {
  session_id: string
  room_uuid: string
  room_no: string | null
  room_name: string | null
  category: string | null
  entered_at: string
  time_minutes: number
  manager_name: string | null
}

type StaffPoolEntry = {
  membership_id: string
  name: string
  role: string
}

type HomeResponse = {
  active_session: ActiveSession | null
  today_count: number
  month_count: number
  chat_unread: number
  staff_pool: StaffPoolEntry[]
}

const ROLE_LABEL: Record<string, string> = {
  owner: "사장",
  manager: "실장",
  waiter: "웨이터",
  staff: "스태프",
  hostess: "스태프",
}

export default function HostessHomePage() {
  const router = useRouter()
  const profile = useCurrentProfile()
  const now = useServerClock(1000)

  const [data, setData] = useState<HomeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [creatingDm, setCreatingDm] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/me/home")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          router.push("/login")
          return
        }
        if (!res.ok) {
          setError("정보를 불러올 수 없습니다.")
          setLoading(false)
          return
        }
        const json = (await res.json()) as HomeResponse
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError("네트워크 오류")
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [router])

  // 경과 시간 계산 (server clock 보정)
  const elapsedMin = useMemo(() => {
    if (!data?.active_session?.entered_at) return 0
    const start = new Date(data.active_session.entered_at).getTime()
    if (!Number.isFinite(start)) return 0
    return Math.max(0, Math.floor((now - start) / 60000))
  }, [data, now])

  const remainingMin = useMemo(() => {
    if (!data?.active_session) return 0
    return data.active_session.time_minutes - elapsedMin
  }, [data, elapsedMin])

  // 직원 검색 필터
  const filteredStaff = useMemo(() => {
    if (!data?.staff_pool) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.staff_pool
    return data.staff_pool.filter((s) => s.name.toLowerCase().includes(q))
  }, [data, search])

  async function startDm(target: StaffPoolEntry) {
    setCreatingDm(target.membership_id)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        body: JSON.stringify({
          kind: "direct",
          peer_membership_id: target.membership_id,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(d.message || d.error || "DM 시작 실패")
        return
      }
      const roomId = d.id || d.chat_room_id
      if (roomId) {
        router.push(`/chat/${roomId}`)
      } else {
        router.push("/chat")
      }
    } catch {
      alert("네트워크 오류")
    } finally {
      setCreatingDm(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] text-slate-400 flex items-center justify-center text-sm">
        로딩 중...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-24">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <span className="font-semibold">홈</span>
        <button
          onClick={() => router.push("/me")}
          className="text-cyan-400 text-xs hover:text-cyan-300"
        >
          내 정보 →
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
        {/* 1. 내 방 카드 */}
        <div className={`rounded-2xl border p-4 ${
          data?.active_session
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : "border-white/10 bg-white/[0.03]"
        }`}>
          <div className="text-xs text-slate-400 mb-2">📍 내 방</div>
          {data?.active_session ? (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold text-emerald-300">
                  {data.active_session.room_no
                    ? `${data.active_session.room_no}번방`
                    : data.active_session.room_name || "방"}
                </span>
                {data.active_session.category && (
                  <span className="text-sm text-slate-300">
                    · {data.active_session.category}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 space-y-0.5 mt-2">
                <div>
                  담당 실장: <span className="text-slate-200">{data.active_session.manager_name ?? "-"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>경과: <span className="text-cyan-300 font-mono">{elapsedMin}분</span></span>
                  <span>잔여: <span className={`font-mono ${remainingMin < 5 ? "text-red-400 font-bold" : remainingMin < 15 ? "text-amber-300" : "text-emerald-300"}`}>{remainingMin}분</span></span>
                  <span className="text-slate-500">/ {data.active_session.time_minutes}분</span>
                </div>
              </div>
              <button
                onClick={() => router.push(`/chat?room=${data.active_session!.room_uuid}`)}
                className="mt-3 w-full text-xs px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              >
                💬 이 방 채팅 열기
              </button>
            </>
          ) : (
            <div className="text-sm text-slate-500 py-2">
              현재 들어간 방이 없습니다.
            </div>
          )}
        </div>

        {/* 2. 내가 일한 갯수 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4 text-center">
            <div className="text-xs text-slate-400">오늘</div>
            <div className="text-3xl font-bold text-cyan-300 mt-1">{data?.today_count ?? 0}</div>
            <div className="text-[10px] text-slate-500 mt-1">건</div>
          </div>
          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4 text-center">
            <div className="text-xs text-slate-400">이번 달</div>
            <div className="text-3xl font-bold text-fuchsia-300 mt-1">{data?.month_count ?? 0}</div>
            <div className="text-[10px] text-slate-500 mt-1">건</div>
          </div>
        </div>

        {/* 3. 채팅 */}
        <button
          onClick={() => router.push("/chat")}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-between hover:bg-white/[0.07]"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">💬</span>
            <span className="text-sm font-medium">채팅</span>
          </div>
          {data?.chat_unread ? (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {data.chat_unread > 99 ? "99+" : data.chat_unread}
            </span>
          ) : (
            <span className="text-xs text-slate-500">→</span>
          )}
        </button>

        {/* 4. DM */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">📨 DM 보내기</div>
            <span className="text-xs text-slate-500">{data?.staff_pool.length ?? 0}명</span>
          </div>
          <input
            type="text"
            placeholder="이름으로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder-slate-500 outline-none focus:border-cyan-500/50"
          />
          <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
            {filteredStaff.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-4">
                {search ? "검색 결과 없음" : "동료가 없습니다."}
              </div>
            ) : (
              filteredStaff.map((s) => (
                <button
                  key={s.membership_id}
                  onClick={() => startDm(s)}
                  disabled={creatingDm === s.membership_id}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 disabled:opacity-50 text-left"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/30 to-fuchsia-500/30 flex items-center justify-center text-xs font-semibold">
                      {s.name.slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-sm">{s.name}</div>
                      <div className="text-[10px] text-slate-500">{ROLE_LABEL[s.role] ?? s.role}</div>
                    </div>
                  </div>
                  <span className="text-xs text-cyan-400">
                    {creatingDm === s.membership_id ? "..." : "DM"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {profile?.role && profile.role !== "hostess" && profile.role !== "staff" && (
          <div className="text-[10px] text-slate-500 text-center pt-2">
            ※ 본 화면은 스태프 시점 home 입니다. {ROLE_LABEL[profile.role] ?? profile.role} 메뉴는 상단 “내 정보 →” 또는 다른 진입점 사용.
          </div>
        )}
      </div>
    </div>
  )
}
