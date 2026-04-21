"use client"

/**
 * STEP-NEXT-UI — /owner/accounts
 *
 * Owner-only same-store account management.
 * Drives entirely off /api/owner/accounts/* — no DB calls, no business
 * rule logic. Allowed status transitions are visualized as enabled/
 * disabled buttons; the server is still the source of truth.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type AccountStatus = "pending" | "approved" | "rejected" | "suspended"
type AccountRole = "owner" | "manager" | "hostess"

type AccountRow = {
  membership_id: string
  profile_id: string
  full_name: string | null
  nickname: string | null
  phone: string | null
  email: string | null
  role: string
  status: string
  created_at: string
  updated_at: string
  approved_by: string | null
  approved_at: string | null
}

type DetailMembership = {
  membership_id: string
  profile_id: string
  store_uuid: string
  role: string
  status: string
  is_primary: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

type DetailProfile = {
  profile_id: string
  full_name: string | null
  nickname: string | null
  phone: string | null
  email: string | null
  created_at: string
  updated_at: string
} | null

type AuditEvent = {
  id: string
  actor_profile_id: string | null
  actor_role: string | null
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string | null
  created_at: string
}

const STATUS_OPTIONS: { value: "" | AccountStatus; label: string }[] = [
  { value: "", label: "전체 상태" },
  { value: "pending", label: "대기 (pending)" },
  { value: "approved", label: "승인 (approved)" },
  { value: "rejected", label: "거부 (rejected)" },
  { value: "suspended", label: "정지 (suspended)" },
]

const ROLE_OPTIONS: { value: "" | AccountRole; label: string }[] = [
  { value: "", label: "전체 역할" },
  { value: "owner", label: "사장 (owner)" },
  { value: "manager", label: "실장 (manager)" },
  { value: "hostess", label: "스태프 (hostess)" },
]

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
    case "pending":
      return "bg-amber-500/15 text-amber-300 border-amber-400/30"
    case "suspended":
      return "bg-orange-500/15 text-orange-300 border-orange-400/30"
    case "rejected":
      return "bg-red-500/15 text-red-300 border-red-400/30"
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-400/30"
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "approved": return "승인"
    case "pending": return "대기"
    case "suspended": return "정지"
    case "rejected": return "거부"
    default: return status
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner": return "사장"
    case "manager": return "실장"
    case "hostess": return "스태프"
    default: return role
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-"
  try { return new Date(iso).toLocaleString("ko-KR") } catch { return iso }
}

export default function OwnerAccountsPage() {
  const router = useRouter()

  const [bootChecked, setBootChecked] = useState(false)
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [q, setQ] = useState("")
  const [statusFilter, setStatusFilter] = useState<"" | AccountStatus>("")
  const [roleFilter, setRoleFilter] = useState<"" | AccountRole>("")
  const [page, setPage] = useState(1)
  const limit = 50

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ membership: DetailMembership; profile: DetailProfile } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  // ─── Role gate ────────────────────────────────────────────────
  useEffect(() => {
    // middleware + /api/auth/me handles real role gating. Boot-check
    // is just a "wait one tick" guard for any stateful init to run.
    setBootChecked(true)
  }, [router])

  // ─── List fetch ───────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set("q", q.trim())
      if (statusFilter) params.set("status", statusFilter)
      if (roleFilter) params.set("role", roleFilter)
      params.set("page", String(page))
      params.set("limit", String(limit))
      const res = await apiFetch(`/api/owner/accounts?${params.toString()}`)
      if (res.status === 401) { router.push("/login"); return }
      if (res.status === 403) { setError("권한이 없습니다 (owner 전용)"); return }
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || data?.message || "목록 조회 실패")
        return
      }
      setAccounts((data.accounts ?? []) as AccountRow[])
      setTotal(typeof data.total === "number" ? data.total : (data.accounts?.length ?? 0))
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [q, statusFilter, roleFilter, page, router])

  useEffect(() => {
    if (!bootChecked) return
    fetchList()
  }, [bootChecked, fetchList])

  // ─── Detail + audit fetch ─────────────────────────────────────
  const fetchDetail = useCallback(async (membershipId: string) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await apiFetch(`/api/owner/accounts/${membershipId}`)
      const data = await res.json()
      if (res.ok) setDetail({ membership: data.membership, profile: data.profile })
      else setError(data?.error || "상세 조회 실패")
    } catch {
      setError("상세 조회 오류")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const fetchAudit = useCallback(async (membershipId: string) => {
    setAuditLoading(true)
    setAudit([])
    try {
      const res = await apiFetch(`/api/owner/accounts/${membershipId}/audit`)
      const data = await res.json()
      if (res.ok) setAudit((data.events ?? []) as AuditEvent[])
    } catch {
      // non-fatal — audit is supplementary
    } finally {
      setAuditLoading(false)
    }
  }, [])

  function selectAccount(id: string) {
    setSelectedId(id)
    setActionMessage(null)
    fetchDetail(id)
    fetchAudit(id)
  }

  // ─── Mutation helper ──────────────────────────────────────────
  async function runAction(action: "approve" | "reject" | "suspend" | "reset-password") {
    if (!selectedId) return
    const labels: Record<typeof action, string> = {
      approve: "승인",
      reject: "거부",
      suspend: "정지",
      "reset-password": "비밀번호 재설정 메일",
    }
    if (action !== "approve") {
      const ok = window.confirm(`${labels[action]} 작업을 진행하시겠습니까?`)
      if (!ok) return
    }
    setActionLoading(action)
    setActionMessage(null)
    try {
      const res = await apiFetch(`/api/owner/accounts/${selectedId}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionMessage(`❌ ${labels[action]} 실패: ${data?.error || data?.message || res.status}`)
        return
      }
      setActionMessage(`✅ ${labels[action]} 완료`)
      // refresh list + detail + audit so UI matches server truth
      await Promise.all([fetchList(), fetchDetail(selectedId), fetchAudit(selectedId)])
    } catch {
      setActionMessage(`❌ ${labels[action]} 중 서버 오류`)
    } finally {
      setActionLoading(null)
    }
  }

  // ─── Action availability (mirrors locked transition matrix) ──
  const detailStatus = detail?.membership?.status as AccountStatus | undefined
  const can = useMemo(() => {
    const s = detailStatus
    return {
      approve: s === "pending" || s === "suspended" || s === "rejected",
      reject: s === "pending",
      suspend: s === "approved",
      resetPassword: s === "approved",
    }
  }, [detailStatus])

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, suspended: 0 }
    for (const a of accounts) {
      if (a.status === "pending") c.pending++
      else if (a.status === "approved") c.approved++
      else if (a.status === "rejected") c.rejected++
      else if (a.status === "suspended") c.suspended++
    }
    return c
  }, [accounts])

  if (!bootChecked) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">권한 확인 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.12),transparent_30%)] pointer-events-none" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <button onClick={() => router.push("/owner")} className="text-cyan-400 text-xs hover:underline">← 사장 대시보드</button>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">계정 관리</h1>
            <p className="text-sm text-slate-400">같은 매장의 계정만 표시됩니다. 모든 작업은 audit log에 기록됩니다.</p>
          </div>
          <button
            onClick={() => fetchList()}
            className="h-9 px-4 rounded-xl border border-white/10 bg-white/[0.04] text-sm hover:bg-white/[0.08]"
          >
            새로고침
          </button>
        </div>

        {/* Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {(["pending","approved","suspended","rejected"] as AccountStatus[]).map((s) => (
            <div key={s} className={`rounded-2xl border px-4 py-3 ${statusBadgeClass(s)}`}>
              <div className="text-[11px] uppercase tracking-wide opacity-80">{statusLabel(s)}</div>
              <div className="text-2xl font-semibold">{counts[s]}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_180px_auto] gap-3 mb-4">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchList() } }}
            placeholder="이름 / 닉네임 / 전화 / 이메일 검색"
            className="h-11 rounded-2xl border border-white/10 bg-[#0A1222]/80 px-4 text-sm outline-none placeholder:text-slate-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as "" | AccountStatus); setPage(1) }}
            className="h-11 rounded-2xl border border-white/10 bg-[#0A1222]/80 px-3 text-sm outline-none [&>option]:bg-[#0A1222]"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value as "" | AccountRole); setPage(1) }}
            className="h-11 rounded-2xl border border-white/10 bg-[#0A1222]/80 px-3 text-sm outline-none [&>option]:bg-[#0A1222]"
          >
            {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={() => { setPage(1); fetchList() }}
            className="h-11 px-5 rounded-2xl bg-cyan-500/20 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30"
          >
            검색
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
          {/* List */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-xs text-slate-400 flex items-center justify-between">
              <span>계정 목록</span>
              <span>총 {total}건 · {accounts.length}건 표시</span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-cyan-300 text-sm">로딩 중...</div>
            ) : accounts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">조건에 맞는 계정이 없습니다.</div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
                {accounts.map((a) => {
                  const isSelected = a.membership_id === selectedId
                  return (
                    <button
                      key={a.membership_id}
                      onClick={() => selectAccount(a.membership_id)}
                      className={`w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors ${isSelected ? "bg-cyan-500/10" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {a.full_name || a.profile_id.slice(0, 8)}
                            {a.nickname && <span className="ml-2 text-xs text-cyan-300">@{a.nickname}</span>}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {roleLabel(a.role)} · {a.email || "-"} · {a.phone || "-"}
                          </div>
                        </div>
                        <span className={`shrink-0 text-[11px] px-2 py-1 rounded-lg border ${statusBadgeClass(a.status)}`}>
                          {statusLabel(a.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-600">
                        생성 {fmtDate(a.created_at)} · 수정 {fmtDate(a.updated_at)}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* simple pagination */}
            {accounts.length > 0 && (
              <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-40"
                >이전</button>
                <span>page {page}</span>
                <button
                  disabled={loading || accounts.length < limit}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-40"
                >다음</button>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-xs text-slate-400">상세 정보</div>
            {!selectedId ? (
              <div className="p-8 text-center text-slate-500 text-sm">왼쪽에서 계정을 선택하세요.</div>
            ) : detailLoading || !detail ? (
              <div className="p-8 text-center text-cyan-300 text-sm">상세 로딩 중...</div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold truncate">
                      {detail.profile?.full_name || detail.membership.profile_id.slice(0, 8)}
                      {detail.profile?.nickname && (
                        <span className="ml-2 text-xs text-cyan-300">@{detail.profile.nickname}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{roleLabel(detail.membership.role)}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-1 rounded-lg border ${statusBadgeClass(detail.membership.status)}`}>
                    {statusLabel(detail.membership.status)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
                    <div className="text-slate-500">이메일</div>
                    <div className="text-slate-200 truncate">{detail.profile?.email || "-"}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
                    <div className="text-slate-500">전화</div>
                    <div className="text-slate-200 truncate">{detail.profile?.phone || "-"}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
                    <div className="text-slate-500">생성</div>
                    <div className="text-slate-200">{fmtDate(detail.membership.created_at)}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
                    <div className="text-slate-500">수정</div>
                    <div className="text-slate-200">{fmtDate(detail.membership.updated_at)}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 col-span-2">
                    <div className="text-slate-500">최근 승인</div>
                    <div className="text-slate-200">
                      {detail.membership.approved_at ? fmtDate(detail.membership.approved_at) : "-"}
                      {detail.membership.approved_by && (
                        <span className="ml-2 text-slate-500">by {detail.membership.approved_by.slice(0, 8)}…</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 col-span-2">
                    <div className="text-slate-500">membership_id</div>
                    <div className="text-slate-200 font-mono break-all">{detail.membership.membership_id}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => runAction("approve")}
                    disabled={!can.approve || actionLoading !== null}
                    className="h-10 rounded-xl bg-emerald-500/15 text-emerald-300 text-xs font-medium border border-emerald-400/20 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {actionLoading === "approve" ? "승인 중..." : "승인 / 재승인"}
                  </button>
                  <button
                    onClick={() => runAction("reject")}
                    disabled={!can.reject || actionLoading !== null}
                    className="h-10 rounded-xl bg-red-500/15 text-red-300 text-xs font-medium border border-red-400/20 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {actionLoading === "reject" ? "거부 중..." : "거부 (pending만)"}
                  </button>
                  <button
                    onClick={() => runAction("suspend")}
                    disabled={!can.suspend || actionLoading !== null}
                    className="h-10 rounded-xl bg-orange-500/15 text-orange-300 text-xs font-medium border border-orange-400/20 hover:bg-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {actionLoading === "suspend" ? "정지 중..." : "정지 (approved만)"}
                  </button>
                  <button
                    onClick={() => runAction("reset-password")}
                    disabled={!can.resetPassword || actionLoading !== null}
                    className="h-10 rounded-xl bg-cyan-500/15 text-cyan-300 text-xs font-medium border border-cyan-400/20 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {actionLoading === "reset-password" ? "전송 중..." : "비밀번호 재설정 메일"}
                  </button>
                </div>

                {actionMessage && (
                  <div className="text-xs px-3 py-2 rounded-lg border border-white/10 bg-white/[0.04] text-slate-200">
                    {actionMessage}
                  </div>
                )}

                {/* Audit */}
                <div>
                  <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                    <span>감사 로그</span>
                    {auditLoading && <span className="text-cyan-300">로딩 중...</span>}
                  </div>
                  {audit.length === 0 && !auditLoading ? (
                    <div className="text-[11px] text-slate-500">기록 없음</div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {audit.map((e) => {
                        const before = e.before as { status?: string } | null
                        const after = e.after as { status?: string } | null
                        return (
                          <div key={e.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="text-cyan-300 font-medium">{e.action}</span>
                              <span className="text-slate-500">{fmtDate(e.created_at)}</span>
                            </div>
                            <div className="text-slate-400 mt-1">
                              {before?.status ?? "-"} → {after?.status ?? "-"}
                              {e.actor_role && <span className="ml-2 text-slate-500">by {e.actor_role}</span>}
                            </div>
                            {e.reason && <div className="text-slate-500 mt-1">사유: {e.reason}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
