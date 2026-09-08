"use client"
/**
 * DuplicateHostessSheet — 동명이인 병합/구분 시트
 *
 * R35 (2026-09-09): 사용자 요구
 *   "중복이름 합칠껀지, 중복은 아닌데 이름이 똑같아서 이름 구분을 해야 하는건지
 *    그런 기능과 메뉴를 만들어줘"
 *
 * 흐름:
 *   1. GET /api/hostesses/duplicates 로 그룹 조회
 *   2. 이름별 카드 렌더 (여러 hostess 옆으로 나열)
 *   3. 사장/실장이 그룹별로 선택:
 *      · 🔗 병합 → 최근 활동 hostess 를 keeper 로 · 나머지 → merge 로 이관
 *      · 🔀 구분 → 각 hostess 에 suffix 추가 (지연 A, 지연 B)
 *      · 나중에 → skip
 *   4. 백엔드 호출:
 *      · 병합: POST /api/hostesses/merge (from, to)
 *      · 구분: PATCH /api/hostesses/[membership_id]/rename (new_name)
 */
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "./Toast"
import { cn } from "../_lib/cn"

type Row = {
  membership_id: string
  profile_id: string
  hostess_name: string
  phone: string | null
  manager_name: string | null
  manager_membership_id: string | null
  created_at: string
  session_count_30d: number
  last_active_at: string | null
  is_working: boolean
}
type Group = { name: string; count: number; hostesses: Row[] }

export function DuplicateHostessSheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // 병합 확인 모달 상태: 어떤 그룹에서 어떤 hostess 를 keeper 로 · 나머지를 merge
  const [mergeTarget, setMergeTarget] = useState<{ group: Group; keeper: Row } | null>(null)
  // 구분 (rename) 모달 상태
  const [renameTarget, setRenameTarget] = useState<{ group: Group } | null>(null)
  // 각 hostess 의 새 이름 (rename 편집용)
  const [renameDraft, setRenameDraft] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/hostesses/duplicates")
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setGroups(j.groups ?? [])
    } catch (e) {
      toast(`로드 실패: ${(e as Error).message}`, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  async function doMerge() {
    if (!mergeTarget || busy) return
    const { group, keeper } = mergeTarget
    const froms = group.hostesses.filter(h => h.membership_id !== keeper.membership_id)
    if (froms.length === 0) {
      setMergeTarget(null)
      return
    }
    setBusy(`merge:${group.name}`)
    try {
      let merged = 0
      for (const f of froms) {
        const res = await apiFetch("/api/hostesses/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_membership_id: f.membership_id, to_membership_id: keeper.membership_id }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(`${f.hostess_name}: ${j?.message ?? `HTTP ${res.status}`}`)
        merged++
      }
      toast(`${group.name} · ${merged}건 병합`, "success")
      setMergeTarget(null)
      await load()
      onChanged?.()
    } catch (e) {
      toast(`병합 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(null)
    }
  }

  async function doRename() {
    if (!renameTarget || busy) return
    const { group } = renameTarget
    // 유효성: 모두 다른 이름 이어야 함, 빈 이름 금지
    const names = group.hostesses.map(h => (renameDraft[h.membership_id] ?? h.hostess_name).trim())
    if (names.some(n => !n)) {
      toast("모든 이름을 입력하세요", "error")
      return
    }
    if (new Set(names).size !== names.length) {
      toast("서로 다른 이름이어야 합니다 (예: '지연 A', '지연 B')", "error")
      return
    }
    setBusy(`rename:${group.name}`)
    try {
      let changed = 0
      for (const h of group.hostesses) {
        const nn = (renameDraft[h.membership_id] ?? h.hostess_name).trim()
        if (nn === h.hostess_name) continue // 변경 없음
        const res = await apiFetch(`/api/hostesses/${encodeURIComponent(h.membership_id)}/rename`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: nn, reason: "동명이인 구분" }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(`${h.hostess_name}: ${j?.message ?? `HTTP ${res.status}`}`)
        changed++
      }
      toast(`${changed}건 이름 변경`, "success")
      setRenameTarget(null)
      setRenameDraft({})
      await load()
      onChanged?.()
    } catch (e) {
      toast(`변경 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(null)
    }
  }

  function openRename(g: Group) {
    // suffix A/B/C... 자동 제안
    const draft: Record<string, string> = {}
    g.hostesses.forEach((h, i) => {
      const suffix = String.fromCharCode(65 + i) // A, B, C, ...
      draft[h.membership_id] = `${h.hostess_name} ${suffix}`
    })
    setRenameDraft(draft)
    setRenameTarget({ group: g })
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#EDE7DA] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[15px] font-black text-[#2D2B26]">👥 동명이인 정리</div>
            <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
              {loading ? "로드중..." : groups.length === 0 ? "동명 그룹 없음" : `${groups.length}개 그룹`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] text-[#7A746A] px-2 py-0.5 active:opacity-60"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* Info bar */}
        <div className="px-5 py-3 bg-[#FAF5EC] border-b border-[#EDE7DA]">
          <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed">
            같은 이름이 여럿 있으면 아래 중 하나를 선택하세요:<br />
            <b className="text-[#468838]">🔗 병합</b> — 같은 사람 · 하나로 통합 (세션 이력 이관 · 되돌리기 불가)<br />
            <b className="text-[#8C6A3A]">🔀 구분</b> — 다른 사람 · 이름에 A/B/C 붙임 (지연 → 지연 A, 지연 B)
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {!loading && groups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-white/60 p-8 text-center">
              <div className="text-[36px] mb-1">🎉</div>
              <div className="text-[13px] font-extrabold text-[#2D2B26]">동명이인 없음</div>
              <div className="text-[10px] font-bold text-[#7A746A] mt-1">모든 아가씨 이름이 매장에서 유일합니다.</div>
            </div>
          )}

          {groups.map(g => (
            <div key={g.name} className="rounded-2xl border-2 border-[#EDE7DA] bg-white overflow-hidden">
              <div className="px-3 py-2 bg-[#FAF5EC] border-b border-[#EDE7DA] flex items-center justify-between">
                <div className="text-[13px] font-black text-[#2D2B26]">
                  「{g.name}」
                </div>
                <div className="text-[10px] font-black text-[#B22563] bg-red-100 rounded-full px-2 py-0.5">
                  {g.count}건 중복
                </div>
              </div>

              {/* Hostess cards */}
              <div className="p-3 space-y-2">
                {g.hostesses.map((h) => (
                  <div key={h.membership_id} className="rounded-xl bg-[#F5F0E5]/50 border border-[#D8D2C8] px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[12px] font-extrabold text-[#2D2B26] flex items-center gap-1.5">
                        {h.hostess_name}
                        {h.is_working && <span className="text-[9px] font-black bg-green-100 text-green-800 rounded px-1.5 py-0.5">방중</span>}
                        {h.session_count_30d === 0 && <span className="text-[9px] font-black bg-red-50 text-red-700 rounded px-1.5 py-0.5">최근 세션 0</span>}
                      </div>
                      <div className="text-[10px] font-black text-[#8C6A3A]">
                        {h.session_count_30d}세션/30일
                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-[#7A746A] space-y-0.5">
                      <div>📞 {h.phone ?? "번호 없음"}</div>
                      <div>👔 담당: {h.manager_name ?? "미지정"}</div>
                      <div>
                        📅 등록 {new Date(h.created_at).toLocaleDateString("ko-KR")}
                        {h.last_active_at && (
                          <span className="ml-2">
                            · 최근 활동 {new Date(h.last_active_at).toLocaleDateString("ko-KR")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="border-t border-[#EDE7DA] px-3 py-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => setMergeTarget({ group: g, keeper: g.hostesses[0] })}
                  className="rounded-lg py-2 text-[11px] font-extrabold border-2 border-green-400 bg-green-50 text-green-800 active:bg-green-100 disabled:opacity-40"
                >
                  🔗 병합 (같은 사람)
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => openRename(g)}
                  className="rounded-lg py-2 text-[11px] font-extrabold border-2 border-[#C49B61] bg-[#FAF5EC] text-[#8C6A3A] active:bg-[#EDE0C4] disabled:opacity-40"
                >
                  🔀 구분 (다른 사람)
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Merge Confirm Modal */}
      {mergeTarget && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setMergeTarget(null)}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-[16px] font-black text-[#2D2B26] mb-2">🔗 병합 확인</div>
            <div className="text-[12px] font-bold text-[#7A746A] leading-relaxed mb-4">
              「{mergeTarget.group.name}」 <b>{mergeTarget.group.count}건</b> 을 하나로 합칩니다.<br /><br />
              <b className="text-[#2D2B26]">아래를 유지 (keeper) 로 선택하세요</b>:
              <br />나머지의 세션 이력이 keeper 로 이관되고, 나머지 membership 은 삭제됩니다.
            </div>
            <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto">
              {mergeTarget.group.hostesses.map(h => (
                <label key={h.membership_id} className={cn(
                  "flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer",
                  mergeTarget.keeper.membership_id === h.membership_id
                    ? "border-green-500 bg-green-50"
                    : "border-[#D8D2C8] bg-white",
                )}>
                  <input
                    type="radio"
                    name="keeper"
                    checked={mergeTarget.keeper.membership_id === h.membership_id}
                    onChange={() => setMergeTarget(t => t ? { ...t, keeper: h } : null)}
                    className="mt-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-extrabold text-[#2D2B26]">
                      {h.hostess_name}
                      {h.is_working && <span className="ml-1 text-[9px] font-black bg-green-100 text-green-800 rounded px-1.5 py-0.5">방중</span>}
                    </div>
                    <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
                      {h.phone ?? "번호 없음"} · 담당 {h.manager_name ?? "미지정"} · {h.session_count_30d}세션/30일
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMergeTarget(null)}
                disabled={!!busy}
                className="flex-1 rounded-xl border-2 border-[#D8D2C8] bg-white py-3 text-[12px] font-extrabold text-[#7A746A] active:bg-[#F5F0E5] disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void doMerge()}
                disabled={!!busy}
                className="flex-1 rounded-xl bg-green-600 py-3 text-[12px] font-extrabold text-white active:bg-green-700 disabled:opacity-40"
              >
                {busy?.startsWith("merge:") ? "병합 중..." : "병합 실행 (되돌리기 불가)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setRenameTarget(null); setRenameDraft({}) }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-[16px] font-black text-[#2D2B26] mb-2">🔀 이름 구분</div>
            <div className="text-[12px] font-bold text-[#7A746A] leading-relaxed mb-4">
              「{renameTarget.group.name}」 각각 다른 이름으로 변경합니다.<br />
              기본으로 A, B, C 붙였으니 필요 시 수정하세요 (예: 「지연1」, 「하퍼지연」 등).
            </div>
            <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto">
              {renameTarget.group.hostesses.map(h => (
                <div key={h.membership_id} className="rounded-xl border border-[#D8D2C8] bg-[#F5F0E5]/40 p-3">
                  <div className="text-[10px] font-bold text-[#7A746A] mb-1">
                    담당 {h.manager_name ?? "미지정"} · {h.session_count_30d}세션/30일 · 📞 {h.phone ?? "없음"}
                  </div>
                  <input
                    type="text"
                    value={renameDraft[h.membership_id] ?? h.hostess_name}
                    onChange={(e) => setRenameDraft(d => ({ ...d, [h.membership_id]: e.target.value }))}
                    maxLength={40}
                    className="w-full rounded-lg border-2 border-[#D8D2C8] bg-white px-3 py-2 text-[13px] font-extrabold text-[#2D2B26] focus:outline-none focus:border-[#C49B61]"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setRenameTarget(null); setRenameDraft({}) }}
                disabled={!!busy}
                className="flex-1 rounded-xl border-2 border-[#D8D2C8] bg-white py-3 text-[12px] font-extrabold text-[#7A746A] active:bg-[#F5F0E5] disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void doRename()}
                disabled={!!busy}
                className="flex-1 rounded-xl bg-[#C49B61] py-3 text-[12px] font-extrabold text-white active:bg-[#A87D45] disabled:opacity-40"
              >
                {busy?.startsWith("rename:") ? "변경 중..." : "이름 변경"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
