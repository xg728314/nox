"use client"
/**
 * /m/store/managers — 실장 관리 페이지 (owner 전용)
 *
 * R-manager-mgmt (2026-09-04): 사용자 요구
 *   "실장이 그만뒀으면 우리가게 정보 못보게 해야돼"
 *
 * 기능:
 *   - 매장 owner/manager 목록 조회
 *   - 각 실장 상태 표시 (활성 / 퇴사)
 *   - '퇴사 처리' 버튼 → status='revoked' + chat 자동 제거
 *   - '재입사' 버튼 → status='approved'
 *
 * 접근 권한:
 *   - owner + super_admin 만
 *   - 마지막 owner · 본인 계정은 revoke 차단
 */
import { useEffect, useState } from "react"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useToast } from "../../../_components/Toast"
import { useMe } from "../../../_hooks/useMobileData"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../_lib/cn"

type Row = {
  membership_id: string
  profile_id: string
  full_name: string
  phone: string | null
  role: "owner" | "manager"
  status: string
  is_primary: boolean
  created_at: string
  deleted_at: string | null
  is_active: boolean
}

export default function ManagersPage() {
  const me = useMe()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // R-confirm-modal (2026-09-04): browser confirm() mobile webview 에서 안 뜸 → in-page modal
  const [confirmTarget, setConfirmTarget] = useState<{ mid: string; name: string; action: "revoke" | "restore" } | null>(null)
  const toast = useToast()

  async function load() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/store/managers")
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setRows(j.items ?? [])
    } catch (e) {
      toast(`로드 실패: ${(e as Error).message}`, "error")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // R-confirm-modal (2026-09-04): 클릭 시 modal 오픈 · 실 처리는 modal 확인 후
  function requestPatch(mid: string, action: "revoke" | "restore", name: string) {
    if (busy) return
    setConfirmTarget({ mid, name, action })
  }

  async function doPatch() {
    if (!confirmTarget || busy) return
    const { mid, name, action } = confirmTarget
    setConfirmTarget(null)
    setBusy(mid)
    try {
      const res = await apiFetch(`/api/store/managers/${encodeURIComponent(mid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(action === "revoke" ? `${name} 퇴사 처리` : `${name} 재입사 처리`, "success")
      void load()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(null)
    }
  }

  const isOwner = me.data?.role === "owner" || me.data?.is_super_admin
  if (!isOwner) {
    return (
      <div className="min-h-dvh bg-[#F5F0E5]">
        <PageHeader title="실장 관리" backHref="/me" />
        <div className="p-6 text-center text-[12px] text-[#7A746A]">
          사장 권한만 접근 가능합니다.
        </div>
        <TabBar />
      </div>
    )
  }

  const active = (rows ?? []).filter(r => r.is_active)
  const revoked = (rows ?? []).filter(r => !r.is_active)

  return (
    <div className="min-h-dvh bg-[#F5F0E5] pb-24">
      <PageHeader title="실장 관리" backHref="/me" />
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3 mb-4">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            실장 관리
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#7A746A] leading-relaxed">
            실장이 그만두면 <b>「퇴사」</b> 눌러 매장 정보 접근 · 채팅 즉시 차단.
            <br />재입사 시 <b>「재입사」</b> 눌러 복원.
          </div>
        </div>

        {loading && (
          <div className="text-[11px] text-[#7A746A] text-center py-6">로드중...</div>
        )}

        {!loading && active.length > 0 && (
          <section className="mb-4">
            <div className="text-[10px] font-black text-green-800 mb-2 uppercase tracking-wider">
              활성 · {active.length}명
            </div>
            <div className="space-y-2">
              {active.map(r => (
                <ManagerCard
                  key={r.membership_id}
                  row={r}
                  isSelf={r.membership_id === me.data?.membership_id}
                  busy={busy === r.membership_id}
                  onAction={a => requestPatch(r.membership_id, a, r.full_name)}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && revoked.length > 0 && (
          <section>
            <div className="text-[10px] font-black text-[#7A746A] mb-2 uppercase tracking-wider">
              퇴사 · {revoked.length}명
            </div>
            <div className="space-y-2 opacity-70">
              {revoked.map(r => (
                <ManagerCard
                  key={r.membership_id}
                  row={r}
                  isSelf={r.membership_id === me.data?.membership_id}
                  busy={busy === r.membership_id}
                  onAction={a => requestPatch(r.membership_id, a, r.full_name)}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && (rows?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-white/60 px-4 py-8 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">실장 없음</div>
          </div>
        )}
      </div>

      {/* R-confirm-modal (2026-09-04): 퇴사/재입사 확인 모달 · mobile webview 에서 확실히 뜨도록 */}
      {confirmTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[16px] font-black text-[#2D2B26] mb-2">
              {confirmTarget.action === "revoke" ? "🚪 퇴사 처리 확인" : "🔄 재입사 처리 확인"}
            </div>
            <div className="text-[12px] font-bold text-[#7A746A] leading-relaxed mb-5">
              {confirmTarget.action === "revoke" ? (
                <>
                  <b className="text-red-700">{confirmTarget.name}</b> 실장을 퇴사 처리합니다.
                  <br />즉시 <b>매장 접근 · 채팅 · 로그인이 차단</b>됩니다.
                  <br /><br />재입사 시 「재입사」 버튼으로 복원 가능합니다.
                </>
              ) : (
                <>
                  <b className="text-green-700">{confirmTarget.name}</b> 실장을 재입사 처리합니다.
                  <br />즉시 매장 접근이 복원됩니다.
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="flex-1 rounded-xl border-2 border-[#D8D2C8] bg-white py-3 text-[13px] font-extrabold text-[#7A746A] active:bg-[#F5F0E5]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void doPatch()}
                className={cn(
                  "flex-1 rounded-xl py-3 text-[13px] font-extrabold text-white",
                  confirmTarget.action === "revoke"
                    ? "bg-red-600 active:bg-red-700"
                    : "bg-green-600 active:bg-green-700",
                )}
              >
                {confirmTarget.action === "revoke" ? "퇴사 처리" : "재입사"}
              </button>
            </div>
          </div>
        </div>
      )}

      <TabBar />
    </div>
  )
}

function ManagerCard({ row, isSelf, busy, onAction }: {
  row: Row; isSelf: boolean; busy: boolean; onAction: (a: "revoke" | "restore") => void
}) {
  return (
    <div className={cn(
      "rounded-2xl border-2 px-3 py-3",
      row.is_active
        ? row.role === "owner"
          ? "border-red-300 bg-red-50/50"
          : "border-[#EDE7DA] bg-white"
        : "border-[#D8D2C8] bg-[#F5F0E5]",
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-black shrink-0",
          row.role === "owner"
            ? "bg-red-100 text-red-700"
            : "bg-[#C49B61]/20 text-[#8C6A3A]",
        )}>
          {row.full_name.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-extrabold text-[#2D2B26] flex items-center gap-1.5">
            {row.full_name}
            <span className={cn(
              "text-[9px] font-black rounded px-1.5 py-0.5",
              row.role === "owner" ? "bg-red-100 text-red-700" : "bg-[#C49B61]/20 text-[#8C6A3A]",
            )}>
              {row.role === "owner" ? "사장" : "실장"}
            </span>
            {isSelf && (
              <span className="text-[9px] font-bold bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">본인</span>
            )}
          </div>
          <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
            {row.phone ?? "번호 없음"}
            {!row.is_active && row.deleted_at && (
              <span className="ml-2 text-red-600">
                · {new Date(row.deleted_at).toLocaleDateString("ko-KR")} 퇴사
              </span>
            )}
          </div>
        </div>
      </div>
      {!isSelf && (
        <div className="mt-2 pt-2 border-t border-[#EDE7DA]">
          {row.is_active ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("revoke")}
              className="w-full rounded-lg py-2 text-[11px] font-extrabold border-2 border-red-400 bg-red-50 text-red-700 active:bg-red-100 disabled:opacity-40"
            >
              {busy ? "..." : "🚪 퇴사 처리 (매장 접근 차단)"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("restore")}
              className="w-full rounded-lg py-2 text-[11px] font-extrabold border-2 border-green-400 bg-green-50 text-green-700 active:bg-green-100 disabled:opacity-40"
            >
              {busy ? "..." : "🔄 재입사 (복원)"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
