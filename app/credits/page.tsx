"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

type Credit = {
  id: string
  room_uuid: string
  room_name: string | null
  manager_membership_id: string
  manager_name: string | null
  customer_name: string
  customer_phone: string | null
  amount: number
  memo: string | null
  status: string
  collected_at: string | null
  created_at: string
}

type Room = { room_uuid: string; room_name: string }
type Manager = { membership_id: string; name: string }

type TabKey = "list" | "create"

export default function CreditsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("list")
  const [credits, setCredits] = useState<Credit[]>([])
  const [statusFilter, setStatusFilter] = useState("pending")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  // 등록 폼 상태
  const [rooms, setRooms] = useState<Room[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [form, setForm] = useState({
    room_uuid: "",
    manager_membership_id: "",
    customer_name: "",
    customer_phone: "",
    amount: "",
    memo: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const profile = useCurrentProfile()
  const role = profile?.role ?? null

  useEffect(() => {
    fetchCredits()
    fetchFormData()
  }, [profile?.membership_id])

  useEffect(() => {
    fetchCredits()
  }, [statusFilter])

  async function fetchCredits() {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/credits?status=${statusFilter}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setCredits(data.credits ?? [])
      } else {
        setError("외상 목록을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function fetchFormData() {
    try {
      const [roomsRes, staffRes] = await Promise.all([
        apiFetch("/api/rooms"),
        apiFetch("/api/store/staff"),
      ])

      if (roomsRes.ok) {
        const data = await roomsRes.json()
        setRooms((data.rooms ?? []).map((r: { room_uuid: string; room_name: string }) => ({
          room_uuid: r.room_uuid,
          room_name: r.room_name,
        })))
      }

      if (staffRes.ok) {
        const data = await staffRes.json()
        const mgrs = (data.staff ?? [])
          .filter((s: { role: string }) => s.role === "manager")
          .map((s: { membership_id: string; name: string }) => ({
            membership_id: s.membership_id,
            name: s.name,
          }))
        setManagers(mgrs)

        // 실장 로그인이면 자동 선택 — membership_id는 서버-인증된 프로필에서 읽음
        if (role === "manager" && mgrs.length > 0 && profile?.membership_id) {
          const myManager = mgrs.find((m: Manager) => m.membership_id === profile.membership_id)
          if (myManager) {
            setForm((prev) => ({ ...prev, manager_membership_id: myManager.membership_id }))
          }
        }
      }
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.room_uuid || !form.manager_membership_id || !form.customer_name.trim() || !form.amount) {
      setError("방, 담당실장, 손님이름, 금액은 필수입니다.")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/credits", {
        method: "POST",
        body: JSON.stringify({
          room_uuid: form.room_uuid,
          manager_membership_id: form.manager_membership_id,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim() || undefined,
          amount: Number(form.amount),
          memo: form.memo.trim() || undefined,
        }),
      })

      if (res.ok) {
        setSuccessMsg("외상 등록 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
        setForm((prev) => ({
          ...prev,
          customer_name: "",
          customer_phone: "",
          amount: "",
          memo: "",
        }))
        setTab("list")
        setStatusFilter("pending")
        fetchCredits()
      } else {
        const data = await res.json()
        setError(data.message || "등록 실패")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAction(creditId: string, action: "collected" | "cancelled") {
    setActionLoading(creditId)
    setError("")
    try {
      const res = await apiFetch(`/api/credits/${creditId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: action }),
      })

      if (res.ok) {
        setSuccessMsg(action === "collected" ? "회수 완료" : "취소 완료")
        setTimeout(() => setSuccessMsg(""), 2000)
        fetchCredits()
      } else {
        const data = await res.json()
        setError(data.message || "처리 실패")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setActionLoading(null)
    }
  }

  function fmt(amount: number): string {
    if (amount >= 10000) {
      const man = Math.floor(amount / 10000)
      const remainder = amount % 10000
      if (remainder === 0) return `${man}만원`
      return `${man}만${remainder.toLocaleString()}원`
    }
    return amount.toLocaleString() + "원"
  }

  const pendingTotal = credits.reduce((sum, c) => sum + c.amount, 0)

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => router.push(role === "owner" ? "/owner" : "/manager")}
            className="text-cyan-400 text-sm"
          >
            ← 대시보드
          </button>
          <span className="font-semibold">외상 관리</span>
          <div className="w-16" />
        </div>

        {/* 메시지 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">닫기</button>
          </div>
        )}
        {successMsg && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {successMsg}
          </div>
        )}

        {/* 탭 */}
        <div className="px-4 pt-4">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("list")}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === "list"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-white/5 text-slate-400 border border-white/10"
              }`}
            >
              외상 목록
            </button>
            <button
              onClick={() => setTab("create")}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === "create"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-white/5 text-slate-400 border border-white/10"
              }`}
            >
              외상 등록
            </button>
          </div>
        </div>

        {/* 목록 탭 */}
        {tab === "list" && (
          <div className="px-4 py-4 space-y-4">
            {/* 상태 필터 */}
            <div className="flex gap-2">
              {[
                { key: "pending", label: "미회수" },
                { key: "collected", label: "회수" },
                { key: "cancelled", label: "취소" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    statusFilter === f.key
                      ? f.key === "pending"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : f.key === "collected"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-500/20 text-slate-300 border border-slate-500/40"
                      : "bg-white/5 text-slate-500 border border-white/10"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* 합계 */}
            {statusFilter === "pending" && credits.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="text-xs text-slate-400">미회수 총액</div>
                <div className="mt-1 text-2xl font-bold text-amber-300">{fmt(pendingTotal)}</div>
                <div className="text-xs text-slate-500 mt-1">{credits.length}건</div>
              </div>
            )}

            {/* 목록 */}
            {loading ? (
              <div className="text-center py-8 text-cyan-400 text-sm">로딩 중...</div>
            ) : credits.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">
                  {statusFilter === "pending" ? "미회수 외상이 없습니다." : "내역이 없습니다."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {credits.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-2xl border p-4 ${
                      c.status === "pending"
                        ? "border-amber-500/20 bg-amber-500/5"
                        : c.status === "collected"
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    {/* 3종 구조 표시 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.customer_name}</span>
                        {c.customer_phone && (
                          <span className="text-xs text-slate-500">{c.customer_phone}</span>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-cyan-300">{fmt(c.amount)}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-2">
                      <div>
                        <span className="block text-slate-500">방</span>
                        <span className="text-white">{c.room_name || "−"}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">담당실장</span>
                        <span className="text-white">{c.manager_name || "−"}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">등록일</span>
                        <span className="text-white">
                          {new Date(c.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </div>

                    {c.memo && (
                      <div className="text-xs text-slate-500 mb-2">메모: {c.memo}</div>
                    )}

                    {/* 액션 버튼 (pending만) */}
                    {c.status === "pending" && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleAction(c.id, "collected")}
                          disabled={actionLoading === c.id}
                          className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all disabled:opacity-50"
                        >
                          {actionLoading === c.id ? "..." : "회수 완료"}
                        </button>
                        <button
                          onClick={() => handleAction(c.id, "cancelled")}
                          disabled={actionLoading === c.id}
                          className="py-2 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-sm border border-white/10 transition-all disabled:opacity-50"
                        >
                          취소
                        </button>
                      </div>
                    )}

                    {c.status === "collected" && c.collected_at && (
                      <div className="text-xs text-emerald-400/60 mt-2">
                        회수: {new Date(c.collected_at).toLocaleDateString("ko-KR")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 등록 탭 */}
        {tab === "create" && (
          <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
            {/* 방 선택 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">방 *</label>
              <select
                value={form.room_uuid}
                onChange={(e) => setForm({ ...form, room_uuid: e.target.value })}
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40"
              >
                <option value="">선택</option>
                {rooms.map((r) => (
                  <option key={r.room_uuid} value={r.room_uuid}>{r.room_name}</option>
                ))}
              </select>
            </div>

            {/* 담당실장 선택 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">담당실장 *</label>
              <select
                value={form.manager_membership_id}
                onChange={(e) => setForm({ ...form, manager_membership_id: e.target.value })}
                disabled={role === "manager"}
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 disabled:opacity-60"
              >
                <option value="">선택</option>
                {managers.map((m) => (
                  <option key={m.membership_id} value={m.membership_id}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* 손님 이름 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">손님 이름 *</label>
              <input
                type="text"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                placeholder="손님 이름"
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
              />
            </div>

            {/* 손님 연락처 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">손님 연락처</label>
              <input
                type="tel"
                value={form.customer_phone}
                onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                placeholder="010-0000-0000"
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
              />
            </div>

            {/* 금액 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">금액 (원) *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
                min="1"
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
              />
            </div>

            {/* 메모 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">메모</label>
              <textarea
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                placeholder="메모 (선택)"
                rows={2}
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm transition-all disabled:opacity-50"
            >
              {submitting ? "등록 중..." : "외상 등록"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
