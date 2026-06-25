"use client"
import { useMemo, useState } from "react"
import { parseStaffChat } from "@/app/counter/helpers/staffChatParser"
import { apiFetch } from "@/lib/apiFetch"
import { useBuildingHostesses, useBuildingStores } from "../../../_hooks/useMobileData"
import { useToast, haptic } from "../../../_components/Toast"

/**
 * R-chat-pattern (2026-06-25): 채팅 메시지 자동 파싱 → "✓ 확인" 버튼.
 *
 *   메시지 예: "택헌 희주 버닝 지수 퍼 완메"
 *     → parseStaffChat → entries:
 *         { name: "택헌", store: null, category: "퍼블릭", ticket_type: "완티" }
 *         { name: "희주", store: "버닝", category: "퍼블릭", ticket_type: "완티" }
 *         { name: "지수", store: "버닝", category: "퍼블릭", ticket_type: "완티" }
 *     → store / category / ticket 모두 식별되고 hostess 1+ 매칭되면 버튼 노출
 *     → 클릭 시 /api/cross-store/dispatch (target_store + hostesses + category +
 *        time_type)
 *
 *   초성 지원: 1글자 한글 초성 (ㅍㅎㅅ 등) → 매칭. 명단 hostess.name 의 첫 글자
 *     초성과 일치하면 후보.
 */

type Cat = "퍼블릭" | "셔츠" | "하퍼"
type TimeKey = "기본" | "반티" | "차3"

const CAT_FROM_LABEL: Record<string, Cat> = {
  퍼블릭: "퍼블릭",
  셔츠: "셔츠",
  하퍼: "하퍼",
}

// 완티 = 기본 / 반티 / 차3 / 반차3 매핑
const TIME_FROM_TICKET: Record<string, TimeKey> = {
  완티: "기본",
  반티: "반티",
  차3: "차3",
  반차3: "반티", // 반차3 은 반티 시간 + 차3 추가 — 기본은 반티로 처리
}

/** 1글자 한글 → 초성 (ㄱㄴㄷ...). 안 매칭이면 빈 문자열. */
function getInitial(char: string): string {
  const cp = char.charCodeAt(0)
  if (cp < 0xac00 || cp > 0xd7a3) return char
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
  const idx = Math.floor((cp - 0xac00) / 588)
  return initials[idx] ?? char
}

export function ChatPatternAction({
  content,
  myStoreUuid,
}: {
  content: string
  myStoreUuid: string | null
}) {
  const buildingH = useBuildingHostesses()
  const buildingS = useBuildingStores()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const parsed = useMemo(() => {
    try {
      const r = parseStaffChat(content, null)
      // entries 중 하나라도 (이름 + store + category + ticket) 모두 있으면 OK
      const ok = r.entries.filter((e) => e.name && e.origin_store_name && e.category && e.ticket_type)
      return { ok, raw: r }
    } catch {
      return { ok: [], raw: { entries: [], warnings: [] } }
    }
  }, [content])

  const resolved = useMemo(() => {
    if (parsed.ok.length === 0) return null
    const allHostesses = buildingH.data?.hostesses ?? []
    const allStores = buildingS.data?.stores ?? []
    // 첫 entry 의 store / category / ticket 으로 그룹 (line-wide invariant)
    const e0 = parsed.ok[0]
    const store = allStores.find((s) => s.store_name === e0.origin_store_name)
    const cat = CAT_FROM_LABEL[e0.category!] ?? null
    const time = TIME_FROM_TICKET[e0.ticket_type!] ?? null
    if (!store || !cat || !time) return null

    // 이름 매칭 — 정확 일치 → prefix → contains → 1글자 초성 순.
    // 후보 1명일 때만 채택 (애매하면 미매칭 분류).
    //
    // 본 매장 식구 우선 → 못 찾으면 target store (origin_store) 식구 우선
    // → 그래도 못 찾으면 전체에서 검색.
    const matchedIds: string[] = []
    const matchedNames: string[] = []
    const unmatched: string[] = []
    for (const ent of parsed.ok) {
      const nm = ent.name.trim()
      if (!nm) continue
      const inStore = allHostesses.filter((h) => h.store_uuid === store.store_uuid)

      // 매칭 시도 ladder
      const candidatesIn = (pool: typeof allHostesses): typeof allHostesses => {
        // 1. 정확 일치
        const exact = pool.filter((h) => (h.hostess_name ?? "").trim() === nm)
        if (exact.length === 1) return exact
        // 2. prefix (이름이 입력으로 시작) — \"지수\" → \"지수01\"
        const prefix = pool.filter((h) => (h.hostess_name ?? "").startsWith(nm))
        if (prefix.length === 1) return prefix
        // 3. contains
        const contains = pool.filter((h) => (h.hostess_name ?? "").includes(nm))
        if (contains.length === 1) return contains
        // 4. 1글자 초성 매칭 (입력 1글자일 때만)
        if (nm.length === 1) {
          const target = getInitial(nm)
          const ini = pool.filter((h) => getInitial((h.hostess_name ?? "").charAt(0)) === target)
          if (ini.length === 1) return ini
        }
        return []
      }

      // 우선순위: target store 안 → 본 매장 → 건물 전체
      let found = candidatesIn(inStore)[0]
      if (!found) {
        const inMyStore = allHostesses.filter((h) => h.store_uuid === myStoreUuid)
        found = candidatesIn(inMyStore)[0]
      }
      if (!found) found = candidatesIn(allHostesses)[0]

      if (found) {
        matchedIds.push(found.membership_id)
        matchedNames.push(found.hostess_name)
      } else {
        unmatched.push(nm)
      }
    }

    return {
      store,
      cat,
      time,
      matchedIds,
      matchedNames,
      unmatched,
    }
  }, [parsed.ok, buildingH.data, buildingS.data])

  // 카드는 store + cat + time 이 인식되면 항상 표시. 매칭 0명이어도 사용자에게
  // \"인식은 됐는데 식구 못 찾음\" 정보 제공 → \"왜 안 떠?\" 혼란 방지.
  if (!resolved) return null

  async function confirm() {
    if (!resolved || submitting || confirmed) return
    setSubmitting(true)
    haptic([10, 30, 10])
    try {
      const sameStore = resolved.store.store_uuid === myStoreUuid
      // 본 매장이든 타 매장이든 dispatch endpoint 가 단일 처리 (server side 동일 분기 X)
      const res = await apiFetch("/api/cross-store/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_store_uuid: resolved.store.store_uuid,
          hostess_membership_ids: resolved.matchedIds,
          category: resolved.cat,
          time_type: resolved.time,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        error?: string
        participants_created?: number
        errors?: string[]
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      const created = j.participants_created ?? 0
      const tag = sameStore ? "본 매장" : resolved.store.store_name
      if (created === 0) {
        throw new Error(j.errors?.[0] ?? "참여자 등록 실패 (이유 불명)")
      }
      toast(`${created}명 → ${tag} 배정 완료`, "success")
      setConfirmed(true)
    } catch (e) {
      toast(`배정 실패: ${(e as Error).message}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const ticketLabel = resolved.time === "기본" ? "완티" : resolved.time

  return (
    <div className="mt-1 rounded-xl border-2 border-[#C49B61]/40 bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] p-2.5">
      <div className="text-[10px] font-extrabold text-[#A87D45] mb-1.5">
        🎯 자동 인식 — {resolved.store.store_name} · {resolved.cat} · {ticketLabel}
      </div>
      <div className="text-[11px] font-bold text-[#2D2B26] leading-snug mb-2">
        {resolved.matchedNames.length > 0 && (
          <span>👉 {resolved.matchedNames.join(", ")}</span>
        )}
        {resolved.unmatched.length > 0 && (
          <span className="text-red-700"> · 미매칭: {resolved.unmatched.join(", ")}</span>
        )}
      </div>
      <button
        type="button"
        disabled={submitting || confirmed || resolved.matchedIds.length === 0}
        onClick={confirm}
        className={`w-full rounded-xl py-2 text-[12px] font-extrabold transition-transform active:scale-[0.98] disabled:opacity-40 ${
          confirmed
            ? "bg-green-500/20 text-green-700 border border-green-300"
            : resolved.matchedIds.length === 0
              ? "bg-[#EFEBE3] text-[#7A746A] border border-[#D8D2C8]"
              : "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white"
        }`}
      >
        {confirmed
          ? "✓ 배정 완료"
          : submitting
            ? "배정 중..."
            : resolved.matchedIds.length === 0
              ? "⚠ 매칭된 식구 없음 — 이름 확인"
              : `✓ 확인 (${resolved.matchedIds.length}명 배정)`}
      </button>
    </div>
  )
}
