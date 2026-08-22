"use client"
/**
 * 아가씨 관리 페이지 · 중복 detect + merge.
 *
 * 유즈케이스:
 *   - 채팅 자동 등록으로 "마블 미연" 등록됨
 *   - 다른 매장 실장이 오탈자 "마블 미언" 으로 별도 등록 → 1명이 2명
 *   - owner 가 이 페이지에서 병합 → 세션 이력 · 정산 참조 소급
 *
 * 권한:
 *   - owner / super_admin: 편집 (merge)
 *   - manager: 조회만
 *   - hostess: 접근 불가
 *
 * R-merge-ui (2026-08-23)
 */
import { useMemo, useState } from "react"
import { useBuildingHostesses, useMe, type BuildingHostess } from "../../_hooks/useMobileData"
import { invalidateApi } from "../../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../_components/Toast"
import Link from "next/link"

/** Levenshtein 거리 · 오탈자 detect 용 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return dp[m][n]
}

/** 두 이름이 병합 후보인가 (같은 매장 · 이름 유사) */
function isCandidate(a: BuildingHostess, b: BuildingHostess): boolean {
  if (a.membership_id === b.membership_id) return false
  if (a.store_uuid !== b.store_uuid) return false // 다른 매장은 병합 대상 아님 (같은 이름이어도)
  const na = (a.hostess_name || "").trim()
  const nb = (b.hostess_name || "").trim()
  if (!na || !nb) return false
  if (na === nb) return true
  const dist = levenshtein(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  // 짧은 이름 (2자 이하) 는 1글자 다름도 후보 · 긴 이름은 2 이하
  if (maxLen <= 2) return dist === 1
  return dist <= 2
}

type MergeCandidate = { a: BuildingHostess; b: BuildingHostess; distance: number }

export default function HostessManagePage() {
  const { data: me } = useMe()
  const { data, refresh } = useBuildingHostesses()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const hostesses = data?.hostesses ?? []
  const role = me?.role
  const isSuper = me?.is_super_admin === true
  const canMerge = role === "owner" || isSuper
  const canRename = role === "owner" || role === "manager" || isSuper

  // 중복 후보 계산
  const candidates: MergeCandidate[] = useMemo(() => {
    const out: MergeCandidate[] = []
    for (let i = 0; i < hostesses.length; i++) {
      for (let j = i + 1; j < hostesses.length; j++) {
        const a = hostesses[i], b = hostesses[j]
        if (isCandidate(a, b)) {
          const dist = levenshtein(a.hostess_name, b.hostess_name)
          out.push({ a, b, distance: dist })
        }
      }
    }
    return out.sort((x, y) => x.distance - y.distance)
  }, [hostesses])

  async function doMerge(from: BuildingHostess, into: BuildingHostess) {
    if (!canMerge) return toast("owner 만 병합 가능", "error")
    const ok = window.confirm(
      `⚠️ 병합\n\n` +
      `[${from.hostess_name}] (${from.store_name}) → [${into.hostess_name}] (${into.store_name})\n\n` +
      `${from.hostess_name} 의 모든 세션 이력 · 정산 참조가 ${into.hostess_name} 로 옮겨집니다.\n` +
      `${from.hostess_name} 은(는) 삭제 마크됩니다. 되돌리기 어려움.\n\n계속?`,
    )
    if (!ok) return
    setBusy(from.membership_id)
    try {
      const res = await apiFetch(`/api/hostesses/${from.membership_id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into_membership_id: into.membership_id, reason: "duplicate_ui" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(`병합 실패: ${j.message || j.error || res.status}`, "error")
      } else {
        const c = j.counts || {}
        toast(
          `병합 완료 · 참여자 ${c.reassigned_participants ?? 0} · 정산 ${c.reassigned_payout_states ?? 0} · alias ${c.reassigned_aliases ?? 0}`,
          "success",
        )
        void invalidateApi("/api/building/hostesses")
        void refresh()
      }
    } catch (e) {
      toast(`병합 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(null)
    }
  }

  async function doRename(h: BuildingHostess, newName: string) {
    if (!canRename) return
    setBusy(h.membership_id)
    try {
      const res = await apiFetch(`/api/hostesses/${h.membership_id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName, reason: "manage_page" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(`이름 수정 실패: ${j.message || j.error || res.status}`, "error")
      } else if (j.unchanged) {
        // no-op
      } else {
        toast(`이름 수정: ${h.hostess_name} → ${newName}`, "success")
        void invalidateApi("/api/building/hostesses")
        void refresh()
      }
    } catch (e) {
      toast(`이름 수정 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5EFE3] pb-24">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center gap-2 mb-4">
          <Link href="/m" className="text-[#7A746A] text-[13px]">← 홈</Link>
          <h1 className="text-[16px] font-extrabold text-[#2D2B26]">아가씨 관리</h1>
        </div>

        {/* 중복 후보 섹션 */}
        <section className="mb-6">
          <h2 className="text-[13px] font-extrabold text-[#A87D45] mb-2">
            🔀 중복 후보 · {candidates.length}건
            {!canMerge && <span className="ml-2 text-[10px] text-[#7A746A]">(owner 만 병합)</span>}
          </h2>
          {candidates.length === 0 ? (
            <div className="rounded-xl bg-white/60 p-4 text-center text-[12px] text-[#7A746A]">
              같은 매장 내에 유사 이름 없음.
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((c, idx) => (
                <div key={idx} className="rounded-xl bg-white border border-[#D8D2C8] p-3">
                  <div className="text-[11px] text-[#7A746A] mb-1">
                    {c.a.store_name} · Levenshtein {c.distance}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 text-[13px] font-extrabold text-[#2D2B26]">
                      {c.a.hostess_name}
                      <span className="text-[10px] text-[#7A746A] font-bold ml-1">
                        (실장: {c.a.manager_name || "—"})
                      </span>
                    </div>
                    <div className="text-[#C49B61] text-[16px]">↔</div>
                    <div className="flex-1 text-[13px] font-extrabold text-[#2D2B26] text-right">
                      {c.b.hostess_name}
                      <span className="text-[10px] text-[#7A746A] font-bold ml-1">
                        (실장: {c.b.manager_name || "—"})
                      </span>
                    </div>
                  </div>
                  {canMerge && (
                    <div className="mt-2 flex gap-2 justify-end">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => doMerge(c.a, c.b)}
                        className="text-[10px] font-extrabold bg-red-50 text-red-700 border border-red-300 px-2 py-1 rounded-full disabled:opacity-40"
                        title={`${c.a.hostess_name} → ${c.b.hostess_name} 로 병합`}
                      >
                        {c.a.hostess_name} → {c.b.hostess_name}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => doMerge(c.b, c.a)}
                        className="text-[10px] font-extrabold bg-red-50 text-red-700 border border-red-300 px-2 py-1 rounded-full disabled:opacity-40"
                        title={`${c.b.hostess_name} → ${c.a.hostess_name} 로 병합`}
                      >
                        {c.b.hostess_name} → {c.a.hostess_name}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 전체 목록 (이름 수정용) */}
        <section>
          <h2 className="text-[13px] font-extrabold text-[#A87D45] mb-2">
            👥 전체 아가씨 · {hostesses.length}명
          </h2>
          <div className="space-y-1">
            {hostesses.map((h) => (
              <div key={h.membership_id} className="rounded-lg bg-white border border-[#D8D2C8]/60 p-2 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-extrabold text-[#2D2B26] truncate">
                    {h.hostess_name}
                    <span className="text-[9px] text-[#7A746A] font-bold ml-1">
                      · {h.store_name}
                      {h.origin_store_name && h.origin_store_name !== h.store_name && (
                        <span className="text-red-700"> (원소속: {h.origin_store_name})</span>
                      )}
                    </span>
                  </div>
                </div>
                {canRename && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const nn = window.prompt(`새 이름 (현재: ${h.hostess_name})`, h.hostess_name)
                      if (nn && nn.trim() && nn.trim() !== h.hostess_name) {
                        void doRename(h, nn.trim())
                      }
                    }}
                    className="text-[9px] text-[#7A746A] hover:text-[#A87D45] px-2 py-1 disabled:opacity-40"
                    title="이름 수정"
                  >
                    ✏️
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
