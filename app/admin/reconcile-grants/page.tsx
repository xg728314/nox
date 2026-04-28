"use client"

/**
 * /admin/reconcile-grants — 종이장부 권한 (paper_ledger_access_grants) 관리.
 *
 * R-Auth: owner only. role default 위에 덮어쓰는 control layer:
 *   - extend          : default deny 인데 명시 허용
 *   - restrict        : default allow 인데 명시 차단
 *   - require_review  : 허용 유지하지만 변경 시 검수 필요 (R-C 에서 활용)
 *
 * 평상시 부담 0 (owner / manager 는 default 로 동작). 예외 케이스만 grant 부여.
 *
 * 운영 가이드:
 *   - 모든 grant 는 만료일 필수 (영구 grant 금지)
 *   - 같은 매장 멤버십에만 부여 가능
 *   - 자기 자신에 부여 불가 (owner 는 grant 없이 자동 통과)
 */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfileState } from "@/lib/auth/useCurrentProfile"

type Grant = {
  id: string
  store_uuid: string
  membership_id: string
  kind: "extend" | "restrict" | "require_review"
  action: "view" | "edit" | "review"
  scope_type: "single_date" | "date_range" | "all_dates"
  business_date: string | null
  date_start: string | null
  date_end: string | null
  granted_by: string
  granted_at: string
  expires_at: string
  revoked_at: string | null
  reason: string | null
}

type StaffMember = {
  membership_id: string
  name: string
  role: string
}

const ROLE_LABEL: Record<string, string> = {
  owner: "사장",
  manager: "실장",
  waiter: "웨이터",
  staff: "스태프",
  hostess: "아가씨",
}

const KIND_META: Record<string, { label: string; tone: string; desc: string }> = {
  extend: {
    label: "허용 (extend)",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    desc: "기본 차단인 사람에게 명시 허용",
  },
  restrict: {
    label: "차단 (restrict)",
    tone: "border-red-500/40 bg-red-500/10 text-red-200",
    desc: "기본 허용인 사람에게 명시 차단",
  },
  require_review: {
    label: "검수 강제 (review)",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    desc: "허용 유지하지만 변경은 owner 검수 후 적용",
  },
}

const ACTION_LABEL: Record<string, string> = {
  view: "보기",
  edit: "편집",
  review: "사람-확정",
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export default function ReconcileGrantsPage() {
  const router = useRouter()
  const profileState = useCurrentProfileState()

  const [grants, setGrants] = useState<Grant[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showForm, setShowForm] = useState(false)

  // role guard — owner 만
  const isOwner = profileState.profile?.role === "owner"

  useEffect(() => {
    if (profileState.loading) return
    if (profileState.needsLogin) {
      router.push("/login")
      return
    }
    if (!profileState.profile) return
    if (profileState.profile.role !== "owner") {
      // 다른 role 은 자기 dashboard 로
      router.push(profileState.profile.role === "manager" ? "/manager" : "/me")
    }
  }, [profileState, router])

  async function load() {
    setLoading(true)
    setError("")
    try {
      const [grantsRes, staffRes] = await Promise.all([
        apiFetch("/api/reconcile/grants"),
        apiFetch("/api/store/staff"),
      ])
      if (grantsRes.status === 401 || grantsRes.status === 403) {
        router.push("/login"); return
      }
      const gd = await grantsRes.json().catch(() => ({}))
      if (!grantsRes.ok) {
        setError(gd.message || "권한 목록 조회 실패")
        return
      }
      setGrants((gd.items ?? []) as Grant[])

      const sd = await staffRes.json().catch(() => ({}))
      if (staffRes.ok) {
        setStaff(((sd.staff ?? []) as StaffMember[]).filter(s => s.role !== "owner"))
      }
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (isOwner) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOwner])

  async function revokeGrant(id: string) {
    if (!confirm("이 권한을 회수하시겠습니까?")) return
    try {
      const res = await apiFetch(`/api/reconcile/grants/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: "ui revoke" }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(d.message || d.error || "회수 실패")
        return
      }
      await load()
    } catch {
      alert("네트워크 오류")
    }
  }

  if (profileState.loading || !profileState.profile) {
    return <div className="min-h-screen bg-[#030814] text-slate-500 flex items-center justify-center text-sm">로딩 중...</div>
  }
  if (!isOwner) {
    return <div className="min-h-screen bg-[#030814] text-slate-500 flex items-center justify-center text-sm">접근 권한 없음 (owner 전용)</div>
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">← 사장 대시보드</button>
        <span className="font-semibold">🔐 종이장부 권한 관리</span>
        <div className="w-32" />
      </div>

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">
        {/* 안내 */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-100/90 leading-relaxed">
          <div className="font-semibold mb-1">권한 모델</div>
          <div>· owner / manager 는 <span className="text-cyan-200">기본적으로 자유롭게 사용</span> — 권한 부여 불필요</div>
          <div>· staff / hostess 는 기본 차단 — 필요시 <span className="text-emerald-300">extend</span> 로 한정 허용</div>
          <div>· 사고 발생 시 manager 에게 <span className="text-red-300">restrict</span> 로 명시 차단 가능</div>
          <div>· 모든 권한은 만료일 필수 (영구 권한 금지, 최대 1년)</div>
        </div>

        {/* R-Learn: 학습 trigger */}
        <LearnPanel />

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">활성 권한 ({grants.length}건)</div>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-500/30"
          >+ 권한 부여</button>
        </div>

        {loading && <div className="text-center text-sm text-slate-500 py-6">불러오는 중...</div>}

        {!loading && grants.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
            활성 권한 없음 — 모든 사용자가 기본 정책으로 동작 중
          </div>
        )}

        {grants.map(g => (
          <GrantCard
            key={g.id}
            grant={g}
            staff={staff}
            onRevoke={() => revokeGrant(g.id)}
          />
        ))}
      </div>

      {showForm && (
        <GrantForm
          staff={staff}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load() }}
        />
      )}
    </div>
  )
}

// ─── 권한 카드 ────────────────────────────────────────────────
function GrantCard({ grant, staff, onRevoke }: { grant: Grant; staff: StaffMember[]; onRevoke: () => void }) {
  const member = staff.find(s => s.membership_id === grant.membership_id)
  const meta = KIND_META[grant.kind]
  const expiresIn = useMemo(() => {
    const ms = new Date(grant.expires_at).getTime() - Date.now()
    if (ms < 0) return "만료됨"
    const days = Math.floor(ms / (24 * 60 * 60 * 1000))
    if (days < 1) return "오늘 만료"
    if (days < 7) return `${days}일 남음`
    return `${days}일 남음`
  }, [grant.expires_at])

  return (
    <div className={`rounded-xl border p-3 ${meta.tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            {member?.name ?? <span className="text-slate-400">알 수 없는 멤버 ({grant.membership_id.slice(0, 8)}…)</span>}
            {member?.role && <span className="ml-2 text-[10px] text-slate-400">[{ROLE_LABEL[member.role] ?? member.role}]</span>}
          </div>
          <div className="text-[11px] mt-0.5 opacity-90">
            <span className="font-semibold">{meta.label}</span>
            {" · "}
            <span>{ACTION_LABEL[grant.action]}</span>
            {" · "}
            <span>{describeScope(grant)}</span>
          </div>
          {grant.reason && (
            <div className="text-[11px] text-slate-400 mt-1 italic">사유: {grant.reason}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="text-[10px] text-slate-400">{expiresIn}</div>
          <button
            onClick={onRevoke}
            className="text-[11px] text-red-300 hover:text-red-200 px-2 py-1 rounded bg-red-500/10 border border-red-500/20"
          >회수</button>
        </div>
      </div>
    </div>
  )
}

function describeScope(g: Grant): string {
  if (g.scope_type === "single_date") return `날짜 ${g.business_date}`
  if (g.scope_type === "date_range") return `기간 ${g.date_start} ~ ${g.date_end}`
  return "전 기간"
}

// ─── R-Learn: 학습 trigger 패널 ─────────────────────────────────
function LearnPanel() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function runLearn(dryRun: boolean) {
    setRunning(true); setError(""); setResult(null)
    try {
      const res = await apiFetch("/api/reconcile/learn", {
        method: "POST",
        body: JSON.stringify({ days: 30, dry_run: dryRun }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "학습 실패")
        return
      }
      const txt = dryRun
        ? `🔍 드라이런: ${d.candidates?.length ?? 0}개 패턴 발견 (적용하면 ${d.would_add ?? 0}개 신규 등록)`
        : `✅ 학습 완료: ${d.new_entries ?? 0}개 신규 등록 (총 사전 크기 ${d.total_dictionary_size ?? 0})`
      setResult(txt)
    } catch {
      setError("네트워크 오류")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
      <div className="text-sm font-semibold text-emerald-200">🧠 종이장부 자동 학습</div>
      <p className="text-[11px] text-emerald-100/80 leading-relaxed">
        최근 30일 사람-수정 기록에서 매장별 호스티스/매장명 패턴을 자동 추출 → 다음 추출 정확도 향상.
        2회 이상 반복된 패턴만 등록 (false positive 방지). 기존 사전 항목은 보호됨.
      </p>
      {result && (
        <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
          {result}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => runLearn(true)}
          disabled={running}
          className="py-1.5 rounded text-[11px] bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] disabled:opacity-50"
        >🔍 미리보기 (적용 X)</button>
        <button
          onClick={() => runLearn(false)}
          disabled={running}
          className="py-1.5 rounded text-[11px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 font-semibold hover:bg-emerald-500/30 disabled:opacity-50"
        >{running ? "분석 중..." : "✅ 학습 실행"}</button>
      </div>
    </div>
  )
}

// ─── 권한 부여 폼 (모달) ──────────────────────────────────────
function GrantForm({ staff, onClose, onSaved }: { staff: StaffMember[]; onClose: () => void; onSaved: () => void }) {
  const [membershipId, setMembershipId] = useState("")
  const [kind, setKind] = useState<Grant["kind"]>("extend")
  const [action, setAction] = useState<Grant["action"]>("view")
  const [scopeType, setScopeType] = useState<Grant["scope_type"]>("single_date")
  const [businessDate, setBusinessDate] = useState(todayISO())
  const [dateStart, setDateStart] = useState(todayISO())
  const [dateEnd, setDateEnd] = useState(todayISO())
  const [expiresDays, setExpiresDays] = useState(30)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState("")

  async function submit() {
    setErr("")
    if (!membershipId) { setErr("멤버십을 선택하세요."); return }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        membership_id: membershipId,
        kind,
        action,
        scope_type: scopeType,
        expires_at: isoPlusDays(expiresDays),
        reason: reason.trim() || null,
      }
      if (scopeType === "single_date") body.business_date = businessDate
      if (scopeType === "date_range") {
        body.date_start = dateStart
        body.date_end = dateEnd
      }

      const res = await apiFetch("/api/reconcile/grants", {
        method: "POST",
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(d.message || d.error || "부여 실패")
        return
      }
      onSaved()
    } catch {
      setErr("네트워크 오류")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-[#0A1222] p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">권한 부여</div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">대상 멤버</label>
          <select
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
          >
            <option value="">선택</option>
            {staff.map(s => (
              <option key={s.membership_id} value={s.membership_id}>
                {s.name} [{ROLE_LABEL[s.role] ?? s.role}]
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">종류</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Grant["kind"])}
              className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
            >
              <option value="extend">extend (허용)</option>
              <option value="restrict">restrict (차단)</option>
              <option value="require_review">require_review (검수)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">대상 액션</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as Grant["action"])}
              className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
            >
              <option value="view">view (보기)</option>
              <option value="edit">edit (편집)</option>
              <option value="review">review (사람-확정)</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-2 text-[11px] text-cyan-100/80">
          {KIND_META[kind].desc}
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">적용 범위</label>
          <select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as Grant["scope_type"])}
            className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
          >
            <option value="single_date">특정 일자만</option>
            <option value="date_range">기간 (시작 ~ 끝)</option>
            <option value="all_dates">전 기간 (만료 전까지 모든 날짜)</option>
          </select>
        </div>

        {scopeType === "single_date" && (
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">영업일</label>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
            />
          </div>
        )}

        {scopeType === "date_range" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">시작일</label>
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">종료일</label>
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">만료 (며칠 후, 최대 365)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={expiresDays}
            onChange={(e) => setExpiresDays(Math.max(1, Math.min(365, parseInt(e.target.value || "30", 10))))}
            className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">사유 (선택)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="예: 신입 manager 검수 필요 / 사고 후 임시 차단"
            className="w-full rounded-lg border border-white/10 bg-[#030814] px-3 py-2 text-sm"
          />
        </div>

        {err && <div className="text-red-400 text-xs">{err}</div>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={submitting}
            className="py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm disabled:opacity-50"
          >취소</button>
          <button
            onClick={submit}
            disabled={submitting || !membershipId}
            className="py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold disabled:opacity-50"
          >{submitting ? "저장 중..." : "부여"}</button>
        </div>
      </div>
    </div>
  )
}
