"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { mapErrorMessage } from "./errorMessages"

/**
 * BulkAssignModal — 미배정(manager_membership_id IS NULL)
 * cross_store_settlement_items 을 다수 선택해 일괄 실장 배정.
 *
 * API 경유:
 *   1) GET  /api/payouts/cross-store-items?unassigned=1[&counterpart_store_uuid=X]
 *      → 미배정 item 리스트 + 각 row reassignable 플래그.
 *   2) GET  /api/store/staff?store_uuid=<target>&role=manager
 *      → target_store 소속 approved manager 목록.
 *   3) PATCH /api/payouts/cross-store-items/:id/assign-manager
 *      → item 단건 배정 (병렬 pool 호출로 bulk 시뮬).
 *
 * 서버가 최종 권한 검증 (store scope / role / paid_amount / status 가드).
 * UI 는 힌트만 — reassignable=false 체크 비활성.
 *
 * 흐름:
 *   open → 아이템 로드 → 수취 매장 선택 (counterpart 지정 시 해당 매장만,
 *   없으면 미배정이 존재하는 매장 목록 중 선택) → 해당 매장의 manager
 *   목록 로드 → 실장 1명 + 대상 item 체크 → 실행.
 */

export type BulkAssignResult = { success: number; failed: number }

type Item = {
  id: string
  cross_store_settlement_id: string
  target_store_uuid: string
  target_store_name: string
  hostess_membership_id: string | null
  hostess_name: string
  amount: number
  paid_amount: number
  remaining_amount: number
  status: string | null
  reassignable: boolean
}

type ManagerOption = {
  membership_id: string
  name: string
}

type Props = {
  open: boolean
  onClose: () => void
  /** Level 2 (특정 counterpart) 에서 열 때 해당 store 로 리스트 범위 제한. */
  counterpartStoreUuid?: string
  /** 일괄 배정 완료 후 상위 재조회 트리거. */
  onDone?: (result: BulkAssignResult) => void
}

const won = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("ko-KR") + "원"
const CONCURRENCY = 4

export default function BulkAssignModal({
  open,
  onClose,
  counterpartStoreUuid,
  onDone,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [targetStoreUuid, setTargetStoreUuid] = useState<string>("")
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [managersLoading, setManagersLoading] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState<string>("")
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // 2026-04-25: 제출 중 모달 unmount 되면 setState 경고 + race. 제출 시작 시
  //   current=true, unmount 시 false 로 바뀌어 worker 의 setState 건너뜀.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const qs = new URLSearchParams({ unassigned: "1" })
      if (counterpartStoreUuid) qs.set("counterpart_store_uuid", counterpartStoreUuid)
      const res = await apiFetch(`/api/payouts/cross-store-items?${qs.toString()}`)
      const d = (await res.json().catch(() => ({}))) as {
        items?: Item[]
        error?: string
        message?: string
      }
      if (!res.ok) {
        setError(mapErrorMessage(d.error, d.message))
        setItems([])
        return
      }
      setItems(d.items ?? [])
    } catch {
      setError("네트워크 오류로 목록을 불러올 수 없습니다")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [counterpartStoreUuid])

  // open 시 reset + items 로드
  useEffect(() => {
    if (!open) return
    setSelectedItemIds(new Set())
    setSelectedManagerId("")
    setManagers([])
    setProgress(null)
    // counterpart 가 지정돼 있으면 targetStore 를 그대로. 아니면 빈 상태로
    // 사용자가 드롭다운에서 선택.
    setTargetStoreUuid(counterpartStoreUuid ?? "")
    void loadItems()
  }, [open, counterpartStoreUuid, loadItems])

  // target_store 변경 시 manager 목록 로드
  useEffect(() => {
    if (!targetStoreUuid) {
      setManagers([])
      setSelectedManagerId("")
      return
    }
    let cancelled = false
    ;(async () => {
      setManagersLoading(true)
      try {
        const qs = new URLSearchParams({
          store_uuid: targetStoreUuid,
          role: "manager",
        })
        const res = await apiFetch(`/api/store/staff?${qs.toString()}`)
        if (cancelled) return
        const d = (await res.json().catch(() => ({}))) as {
          staff?: Array<{ membership_id?: string; name?: string; role?: string }>
        }
        const raw = d.staff ?? []
        setManagers(
          raw
            .filter((m) => (m.role ?? "manager") === "manager")
            .map((m) => ({
              membership_id: String(m.membership_id ?? ""),
              name: String(m.name ?? ""),
            }))
            .filter((m) => m.membership_id),
        )
        setSelectedManagerId("")
      } catch {
        if (!cancelled) setManagers([])
      } finally {
        if (!cancelled) setManagersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [targetStoreUuid])

  if (!open) return null

  // target_store 별 그룹 (드롭다운 옵션용) — 지정이 없을 때만 유의미
  const storeGroups = Array.from(
    items
      .reduce((map, it) => {
        const g = map.get(it.target_store_uuid) ?? {
          uuid: it.target_store_uuid,
          name: it.target_store_name,
          count: 0,
        }
        g.count += 1
        map.set(it.target_store_uuid, g)
        return map
      }, new Map<string, { uuid: string; name: string; count: number }>())
      .values(),
  )

  const visibleItems = targetStoreUuid
    ? items.filter((it) => it.target_store_uuid === targetStoreUuid)
    : []

  function toggle(id: string, reassignable: boolean) {
    if (!reassignable) return
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    const ids = visibleItems.filter((it) => it.reassignable).map((it) => it.id)
    setSelectedItemIds(new Set(ids))
  }

  function clearSelection() {
    setSelectedItemIds(new Set())
  }

  async function submit() {
    if (submitting) return
    if (!selectedManagerId) {
      setError("배정할 실장을 선택하세요.")
      return
    }
    if (selectedItemIds.size === 0) {
      setError("배정 대상 항목을 선택하세요.")
      return
    }
    setError("")
    setSubmitting(true)
    setProgress({ done: 0, total: selectedItemIds.size })
    let success = 0
    let failed = 0
    const errorSamples: string[] = []

    const ids = Array.from(selectedItemIds)
    let cursor = 0
    async function worker() {
      while (cursor < ids.length) {
        const i = cursor++
        const id = ids[i]
        try {
          const res = await apiFetch(
            `/api/payouts/cross-store-items/${id}/assign-manager`,
            {
              method: "PATCH",
              body: JSON.stringify({ manager_membership_id: selectedManagerId }),
            },
          )
          const d = (await res.json().catch(() => ({}))) as {
            error?: string
            message?: string
          }
          if (!res.ok) {
            failed += 1
            if (errorSamples.length < 3)
              errorSamples.push(mapErrorMessage(d.error, d.message))
          } else {
            success += 1
          }
        } catch {
          failed += 1
          if (errorSamples.length < 3) errorSamples.push("네트워크 오류")
        } finally {
          if (mountedRef.current) {
            setProgress({ done: success + failed, total: ids.length })
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()),
    )
    if (!mountedRef.current) return
    setSubmitting(false)

    if (failed === 0) {
      onDone?.({ success, failed })
      onClose()
      return
    }

    setError(
      `완료 ${success}건 / 실패 ${failed}건. 대표 사유: ${errorSamples.join(" · ")}`,
    )
    // 실패분 포함한 현재 상태 반영 위해 리스트 재조회
    await loadItems()
    setSelectedItemIds(new Set())
    onDone?.({ success, failed })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] max-h-[90vh] rounded-2xl bg-[#0d1020] border border-white/10 p-4 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-bold">실장 일괄 배정</div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          미배정(실장 없음) 정산 항목에 담당 실장을 배정합니다. 이미 지급이
          시작됐거나 완료/취소된 항목은 체크할 수 없습니다. 실장은 수취
          매장(origin_store) 소속이어야 합니다.
        </div>

        {/* target store selector (counterpart 지정 시 읽기 전용 표시) */}
        <div className="mb-2">
          <label className="text-[11px] text-slate-400 block mb-1">
            수취 매장 (target_store)
          </label>
          {counterpartStoreUuid ? (
            <div className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white">
              {storeGroups.find((g) => g.uuid === counterpartStoreUuid)?.name ||
                counterpartStoreUuid.slice(0, 8)}
              <span className="ml-2 text-[10px] text-slate-500">
                ({storeGroups.find((g) => g.uuid === counterpartStoreUuid)?.count ?? 0}건)
              </span>
            </div>
          ) : (
            <select
              value={targetStoreUuid}
              onChange={(e) => {
                setTargetStoreUuid(e.target.value)
                setSelectedItemIds(new Set())
              }}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white"
            >
              <option value="">매장 선택...</option>
              {storeGroups.map((g) => (
                <option key={g.uuid} value={g.uuid}>
                  {g.name || g.uuid.slice(0, 8)} ({g.count}건)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* manager selector */}
        <div className="mb-2">
          <label className="text-[11px] text-slate-400 block mb-1">실장</label>
          <select
            value={selectedManagerId}
            onChange={(e) => setSelectedManagerId(e.target.value)}
            disabled={!targetStoreUuid || managersLoading || managers.length === 0}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white disabled:opacity-40"
          >
            <option value="">
              {!targetStoreUuid
                ? "매장 먼저 선택"
                : managersLoading
                  ? "실장 목록 로드 중..."
                  : managers.length === 0
                    ? "배정 가능한 실장 없음"
                    : "실장 선택..."}
            </option>
            {managers.map((m) => (
              <option key={m.membership_id} value={m.membership_id}>
                {m.name || m.membership_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>

        {/* items list */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-white/5 mb-2">
          {loading ? (
            <div className="p-4 text-center text-slate-500 text-xs animate-pulse">
              불러오는 중...
            </div>
          ) : !targetStoreUuid ? (
            <div className="p-4 text-center text-slate-600 text-xs">
              수취 매장을 선택하세요
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs">
              해당 매장에 미배정 항목이 없습니다
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-1.5 bg-white/[0.03] border-b border-white/5 text-[10px]">
                <span className="text-slate-400">
                  선택 {selectedItemIds.size} / {visibleItems.length}건
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="text-cyan-300 hover:text-cyan-200"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-slate-400 hover:text-white"
                  >
                    해제
                  </button>
                </div>
              </div>
              <div className="divide-y divide-white/5">
                {visibleItems.map((it) => {
                  const checked = selectedItemIds.has(it.id)
                  return (
                    <label
                      key={it.id}
                      className={`flex items-center gap-2 px-2 py-2 text-[11px] ${
                        it.reassignable
                          ? "hover:bg-white/[0.04] cursor-pointer"
                          : "opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!it.reassignable}
                        onChange={() => toggle(it.id, it.reassignable)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 truncate">
                          {it.hostess_name || "(이름 미확인)"}{" "}
                          <span className="text-slate-600">· {it.id.slice(0, 8)}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {won(it.amount)} · 잔액 {won(it.remaining_amount)} ·{" "}
                          {it.status ?? "-"}
                          {!it.reassignable && (
                            <span className="ml-2 text-rose-300">(재배정 불가)</span>
                          )}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="p-2 mb-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
            {error}
          </div>
        )}

        {progress && (
          <div className="p-2 mb-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-cyan-300 text-[11px]">
            진행 {progress.done} / {progress.total}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-white/5"
          >
            닫기
          </button>
          <button
            onClick={submit}
            disabled={submitting || !selectedManagerId || selectedItemIds.size === 0}
            className="px-4 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-200 text-xs font-semibold hover:bg-purple-500/30 disabled:opacity-50"
          >
            {submitting ? "배정 중..." : `선택 ${selectedItemIds.size}건 배정`}
          </button>
        </div>
      </div>
    </div>
  )
}
