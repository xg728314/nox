"use client"
import { useEffect, useMemo, useState, useCallback } from "react"
import { parseStaffChat, type ParsedStaffEntry } from "@/app/counter/helpers/staffChatParser"
import { apiFetch } from "@/lib/apiFetch"
import { useBuildingHostesses, useBuildingStores, useMe } from "../../../_hooks/useMobileData"
import { invalidateApi } from "../../../_hooks/useApi"
import { useToast, haptic } from "../../../_components/Toast"

/**
 * R-chat-pattern-mutual (2026-06-26): 채팅 메시지 자동 파싱 → 임시 등록 +
 *   다자간 교차 확인 시스템.
 *
 * 흐름:
 *   1. 메시지 \"버 지수 신 지연 파 은비 하 완메\" → parseStaffChat → 3 entries
 *      (각각 다른 origin_store_name)
 *   2. 발신자 \"✓ 확인 (3개 매장 임시 등록)\" → POST /api/chat/pattern-dispatch
 *      → chat_pattern_dispatches 에 3 row 생성 (status=pending)
 *   3. 각 target 매장 매니저는 자기 row 의 \"확인\" 버튼 클릭 →
 *      target_confirmed_by/at 채움
 *   4. 모든 row 확인 완료 시 자동 실제 dispatch (session + participant 생성)
 *   5. 카드 \"임시 등록 X/N 확인됨\" → \"✓ 모두 확인 — 배정 완료\"
 *
 * 카드 단일/멀티 store 처리 동일.
 */

type Cat = "퍼블릭" | "셔츠" | "하퍼"
type TimeKey = "기본" | "반티" | "차3"

const CAT_FROM_LABEL: Record<string, Cat> = {
  퍼블릭: "퍼블릭",
  셔츠: "셔츠",
  하퍼: "하퍼",
}
const TIME_FROM_TICKET: Record<string, TimeKey> = {
  완티: "기본",
  반티: "반티",
  차3: "차3",
  반차3: "반티",
}

function getInitial(char: string): string {
  const cp = char.charCodeAt(0)
  if (cp < 0xac00 || cp > 0xd7a3) return char
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
  const idx = Math.floor((cp - 0xac00) / 588)
  return initials[idx] ?? char
}

type ServerDispatch = {
  id: string
  target_store_uuid: string
  hostess_membership_id: string
  category: string
  time_type: string
  /** R-room-prefix (2026-06-28): 라인의 "1번방" prefix 에서 추출된 방번호 */
  room_no?: string | null
  status: string
  target_confirmed_by: string | null
  target_confirmed_at?: string | null
  executed_session_id?: string | null
}

export function ChatPatternAction({
  content,
  chatMessageId,
  myStoreUuid,
}: {
  content: string
  chatMessageId: string
  myStoreUuid: string | null
}) {
  const buildingH = useBuildingHostesses()
  const buildingS = useBuildingStores()
  const me = useMe()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [serverDispatches, setServerDispatches] = useState<ServerDispatch[]>([])

  // 1. parseStaffChat 으로 entries 추출
  const parsed = useMemo(() => {
    try { return parseStaffChat(content, null) } catch { return { entries: [], warnings: [] } }
  }, [content])

  // entries 중 (이름, store, category, ticket) 모두 있는 것만
  const validEntries = useMemo(
    () => parsed.entries.filter((e) => e.name && e.origin_store_name && e.category && e.ticket_type),
    [parsed.entries],
  )

  // 2. 각 entry → resolve target_store_uuid + hostess_membership_id + cat + time
  type ResolvedEntry = {
    target_store_uuid: string
    target_store_name: string
    hostess_membership_id: string | null
    hostess_name: string
    category: Cat
    time_type: TimeKey
    origin_label: string
    unmatched?: string
    /** R-room-prefix (2026-06-28): parser 가 추출한 "1번방" 의 방번호 */
    room_no: string | null
  }
  const resolvedEntries = useMemo<ResolvedEntry[]>(() => {
    if (validEntries.length === 0) return []
    const allHostesses = buildingH.data?.hostesses ?? []
    const allStores = buildingS.data?.stores ?? []
    const out: ResolvedEntry[] = []
    for (const e of validEntries) {
      // validEntries 필터에서 모두 non-null 보장됨
      if (!e.origin_store_name || !e.category || !e.ticket_type || !e.name) continue
      const store = allStores.find((s) => s.store_name === e.origin_store_name)
      const cat = CAT_FROM_LABEL[e.category] as Cat | undefined
      const time = TIME_FROM_TICKET[e.ticket_type] as TimeKey | undefined
      if (!store || !cat || !time) continue
      const eName = e.name

      // 이름 매칭 (target store → 본 매장 → 전체)
      const candidates = (pool: typeof allHostesses): typeof allHostesses => {
        const nm = eName.trim()
        if (!nm) return []
        const exact = pool.filter((h) => (h.hostess_name ?? "").trim() === nm)
        if (exact.length === 1) return exact
        const prefix = pool.filter((h) => (h.hostess_name ?? "").startsWith(nm))
        if (prefix.length === 1) return prefix
        const contains = pool.filter((h) => (h.hostess_name ?? "").includes(nm))
        if (contains.length === 1) return contains
        if (nm.length === 1) {
          const target = getInitial(nm)
          const ini = pool.filter((h) => getInitial((h.hostess_name ?? "").charAt(0)) === target)
          if (ini.length === 1) return ini
        }
        return []
      }
      let found = candidates(allHostesses.filter((h) => h.store_uuid === store.store_uuid))[0]
      if (!found) found = candidates(allHostesses.filter((h) => h.store_uuid === myStoreUuid))[0]
      if (!found) found = candidates(allHostesses)[0]

      out.push({
        target_store_uuid: store.store_uuid,
        target_store_name: store.store_name,
        hostess_membership_id: found?.membership_id ?? null,
        hostess_name: found?.hostess_name ?? eName,
        category: cat,
        time_type: time,
        origin_label: `${store.store_name} · ${cat} · ${time === "기본" ? "완티" : time}`,
        unmatched: found ? undefined : eName,
        room_no: e.room_no ?? null,
      })
    }
    return out
  }, [validEntries, buildingH.data, buildingS.data, myStoreUuid])

  // 3. 서버 임시 등록 상태 조회 (3초 polling — 채팅 polling 과 별도)
  const fetchDispatches = useCallback(async () => {
    if (!chatMessageId) return // guard — 400 방지
    try {
      const res = await apiFetch(`/api/chat/pattern-dispatch?chat_message_id=${encodeURIComponent(chatMessageId)}`)
      if (!res.ok) return
      const j = (await res.json()) as { dispatches?: ServerDispatch[] }
      setServerDispatches(j.dispatches ?? [])
    } catch { /* swallow */ }
  }, [chatMessageId])
  useEffect(() => {
    fetchDispatches()
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchDispatches()
    }, 4000)
    return () => clearInterval(id)
  }, [fetchDispatches])

  // 4. 발신자 — \"확인\" 클릭 → 임시 등록 생성
  async function createPending() {
    if (submitting || resolvedEntries.length === 0) return
    const matched = resolvedEntries.filter((e) => e.hostess_membership_id)
    if (matched.length === 0) {
      toast("매칭된 식구 없음", "error")
      return
    }
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/chat/pattern-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_message_id: chatMessageId,
          entries: matched.map((e) => ({
            target_store_uuid: e.target_store_uuid,
            hostess_membership_id: e.hostess_membership_id,
            category: e.category,
            time_type: e.time_type,
            room_no: e.room_no,
          })),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; dispatches?: ServerDispatch[]; already?: boolean }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      const created = j.dispatches ?? []
      setServerDispatches(created)

      // R-auto-confirm (2026-06-26): super_admin / owner 발신 시 즉시 자동 confirm.
      // R-auto-confirm-manager (2026-06-28): manager 도 본인 매장에만 외부 식구
      //   부르는 경우 자동 confirm 허용 (모든 entries 의 target_store 가 본인 매장).
      const targetsAllMine = matched.every((e) => e.target_store_uuid === me.data?.store_uuid)
      const isAutoActor =
        me.data?.is_super_admin
        || me.data?.role === "owner"
        || (me.data?.role === "manager" && targetsAllMine)
      if (isAutoActor && created.length > 0) {
        toast(`임시 등록 ${created.length}건 — 자동 확인 중...`, "info")
        // 순차 confirm (마지막 호출 시 cross-store dispatch 실제 실행됨)
        let executed = 0
        for (const d of created) {
          if (d.status !== "pending") continue
          try {
            const cf = await apiFetch(`/api/chat/pattern-dispatch/${encodeURIComponent(d.id)}/confirm`, { method: "POST" })
            if (cf.ok) executed++
          } catch { /* 개별 실패 — 다음 진행 */ }
        }
        toast(`✓ ${executed}건 cross-store 등록 완료`, "success")
        // 외부 식구 섹션 즉시 반영
        invalidateApi("/api/manager/incoming-staff")
        invalidateApi("/api/manager/hostesses")
        invalidateApi("/api/rooms")
        invalidateApi("/api/manager/active-room-chats")
        // 최신 dispatches 다시 fetch
        try {
          const r2 = await apiFetch(`/api/chat/pattern-dispatch?chat_message_id=${encodeURIComponent(chatMessageId)}`)
          const jj = await r2.json().catch(() => ({}))
          if (Array.isArray(jj?.dispatches)) setServerDispatches(jj.dispatches)
        } catch { /* swallow */ }
      } else {
        toast(j.already ? "이미 등록됨" : `임시 등록 ${created.length}건 — 상대 매장 확인 대기`, "success")
      }
    } catch (e) {
      toast(`등록 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // 5. 수신측 매니저 — 자기 store 의 dispatch 확인
  async function confirmOne(dispatchId: string) {
    if (submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(`/api/chat/pattern-dispatch/${encodeURIComponent(dispatchId)}/confirm`, { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; all_confirmed?: boolean; executed?: boolean; dispatches?: ServerDispatch[] }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      setServerDispatches(j.dispatches ?? [])
      if (j.executed) toast("모든 확인 완료 — 배정 실행됨", "success")
      else toast("확인됨 (대기 중)", "success")
    } catch (e) {
      toast(`확인 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // 6. 수신측 매니저 — 임시 등록 취소 (잘못 기재 인지)
  async function rejectOne(dispatchId: string) {
    if (submitting) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(`/api/chat/pattern-dispatch/${encodeURIComponent(dispatchId)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "이름/매장 잘못 기재 — 재등록 필요" }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; dispatches?: ServerDispatch[] }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      setServerDispatches(j.dispatches ?? [])
      toast("취소됨 — 발신자 재등록 가능", "info")
    } catch (e) {
      toast(`취소 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // 카드는 store/cat/time 인식되면 항상 표시
  if (resolvedEntries.length === 0) return null

  const isPending = serverDispatches.length > 0
  const confirmedCount = serverDispatches.filter((d) => d.target_confirmed_by != null).length
  const approvedAll = serverDispatches.length > 0 && serverDispatches.every((d) => d.status === "approved")

  return (
    <div className="mt-1 rounded-xl border-2 border-[#C49B61]/40 bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] p-2.5">
      <div className="text-[10px] font-extrabold text-[#A87D45] mb-1.5">
        🎯 자동 인식 — {resolvedEntries.length}건
        {isPending && (
          <span className={`ml-2 ${approvedAll ? "text-green-700" : "text-red-700"}`}>
            · {approvedAll ? "✓ 모두 확인됨" : `확인 ${confirmedCount}/${serverDispatches.length}`}
          </span>
        )}
      </div>
      {/* entry 목록 — 매장별 상태 */}
      <div className="space-y-1 mb-2">
        {resolvedEntries.map((e, idx) => {
          const matchedDispatch = serverDispatches.find(
            (d) => d.target_store_uuid === e.target_store_uuid && d.hostess_membership_id === e.hostess_membership_id,
          )
          const isMyTarget = e.target_store_uuid === myStoreUuid
          const dStatus = matchedDispatch?.status ?? null
          const dConfirmed = matchedDispatch?.target_confirmed_by != null

          let badge: string
          let badgeCls: string
          if (e.unmatched) {
            badge = "미매칭"
            badgeCls = "bg-red-100 text-red-700"
          } else if (dStatus === "approved") {
            badge = "✓ 배정"
            badgeCls = "bg-green-100 text-green-700"
          } else if (dStatus === "rejected") {
            badge = "✗ 거절"
            badgeCls = "bg-red-100 text-red-700"
          } else if (dConfirmed) {
            badge = "✓ 확인"
            badgeCls = "bg-blue-100 text-blue-700"
          } else if (isPending) {
            badge = "대기"
            badgeCls = "bg-amber-100 text-amber-800"
          } else {
            badge = "—"
            badgeCls = "bg-[#EFEBE3] text-[#7A746A]"
          }

          return (
            <div key={idx} className="flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-extrabold text-[#2D2B26] truncate flex items-center gap-1 flex-wrap">
                  {/* R-room-no-badge (2026-06-28): 방번호 prefix 인식됐으면 빨간 배지 */}
                  {e.room_no && (
                    <span className="inline-flex items-center text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 border border-red-200">
                      🚪 {e.room_no}번방
                    </span>
                  )}
                  <span>{e.target_store_name}</span>
                  <span className="text-[#7A746A] font-bold">·</span>
                  <span>{e.hostess_name}</span>
                  {e.unmatched && <span className="text-red-700">({e.unmatched})</span>}
                </div>
                <div className="text-[9px] font-bold text-[#7A746A]">
                  {e.category} · {e.time_type === "기본" ? "완티" : e.time_type}
                </div>
              </div>
              <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${badgeCls}`}>{badge}</span>
              {/* 수신측 확인/취소 버튼 — pending + 본 매장 target + 아직 미확인 */}
              {isMyTarget && matchedDispatch && !dConfirmed && dStatus === "pending" && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => confirmOne(matchedDispatch.id)}
                    className="text-[9px] font-extrabold bg-[#C49B61] text-white px-2 py-1 rounded-full disabled:opacity-40"
                  >
                    ✓ 확인
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => rejectOne(matchedDispatch.id)}
                    className="text-[9px] font-extrabold bg-red-50 text-red-700 border border-red-300 px-2 py-1 rounded-full disabled:opacity-40"
                    title="잘못 기재 — 취소"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {/* 발신자 — 아직 임시 등록 안 만들었으면 \"임시 등록\" 버튼 */}
      {!isPending && (
        <button
          type="button"
          disabled={submitting}
          onClick={createPending}
          className="w-full rounded-xl py-2 text-[12px] font-extrabold transition-transform active:scale-[0.98] disabled:opacity-40 bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white"
        >
          {submitting ? "등록 중..." : `📝 임시 등록 (${resolvedEntries.filter((e) => !e.unmatched).length}건)`}
        </button>
      )}
      {isPending && approvedAll && (
        <div className="w-full rounded-xl py-2 text-center text-[12px] font-extrabold bg-green-500/20 text-green-700 border border-green-300">
          ✓ 모든 확인 완료 — 배정 실행됨
        </div>
      )}
      {isPending && !approvedAll && (
        <div className="text-center text-[10px] font-bold text-[#7A746A]">
          상대 매장 매니저 확인 대기 중 — {confirmedCount}/{serverDispatches.length}
        </div>
      )}
    </div>
  )
}
