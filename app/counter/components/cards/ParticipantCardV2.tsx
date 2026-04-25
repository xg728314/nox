"use client"

import type { Participant } from "../../types"
import {
  remainingMsForParticipant,
  roomRemainingMs,
  fmtRemaining,
  remainingColor,
  profitMs,
  fmtMinutes,
  fmtUnitCount,
  fmtWon,
  fmtTime,
  resolveBaseCategory,
  resolveParticipantElapsed,
} from "../../helpers"
import { matchStateLabel } from "../../helpers/nameMatcher"
import { computeHostessMatch, type HostessMatchCandidate } from "../../helpers/hostessMatcher"

type Props = {
  h: Participant
  selected: boolean
  currentStoreUuid: string | null
  basis: "room" | "individual"
  now: number
  participants: Participant[]
  sessionStartedAt: string
  onToggle: (id: string) => void
  onOpenEdit: (id: string) => void
  onNameBlur: (id: string, cur: string | null | undefined, next: string) => Promise<void>
  onMidOut: (id: string) => void
  onDelete: (id: string) => void
  /**
   * Inline edit hotspots — 5개 표시값을 클릭해서 바로 수정할 수 있게 한다.
   * mode는 editor 가 어떤 필드를 편집하는지 결정.
   *   manager   : 실장 교체
   *   store     : 소속 매장 교체
   *   entered   : 입실 시각 수정
   *   count     : 종목 N개 수정
   *   end       : 종료 시각 수정
   * row 전체 click(onToggle)과 충돌 방지를 위해 버튼 onClick에서
   * stopPropagation 필수.
   */
  onInlineEdit?: (
    mode: "manager" | "store" | "entered" | "count" | "end",
    participantId: string,
  ) => void
  /**
   * Optional pool of known hostesses (store-scoped). Structured
   * HostessMatchCandidate[] enables context-aware scoring (same-store /
   * same-manager / activity / recent-assignment bonuses). Plain string[]
   * falls back to name-only matching. When this row is already linked to
   * a real membership, no overlay is rendered (server truth wins).
   *   EXACT    → 이름 일치 (green)
   *   POSSIBLE → 후보 있음 (cyan, shows suggested name)
   *   CONFLICT → 확정 필요 (amber, shows top candidates)
   *   NONE     → 매칭 없음 (slate, low-emphasis)
   * The participant row itself and the entered name are never mutated.
   */
  hostessNamePool?: HostessMatchCandidate[] | string[]
  /**
   * Current room's dominant manager membership_id, used for the
   * same-manager scoring bonus. May be null (bonus dropped).
   */
  currentManagerMembershipId?: string | null
}

/**
 * Phase 2: compact 2-row ledger-style card.
 *
 * Props contract is IDENTICAL to the prior version (same 13 fields).
 * Only JSX/CSS restructure — no network, no new hooks, no new handlers.
 * Helper imports are the same set plus `fmtWon` + `fmtTime` which
 * already exist in ../helpers.
 *
 * Layout:
 *   Row 1: [소속T] 이름 · 진행 badge · status badges (unmatched/?/반)
 *   Row 2: 실장 · 입실 · 종목+단위 · 금액 · (hover) 티변경/팅김
 *
 * Unresolved state (no category / no time_minutes) retains its own
 * compact "탭하여 설정" card with the inline name input — identical to
 * prior behavior.
 */
export default function ParticipantCardV2({
  h, selected, currentStoreUuid, basis, now,
  participants, sessionStartedAt,
  onToggle, onOpenEdit, onNameBlur, onMidOut, onDelete,
  hostessNamePool,
  currentManagerMembershipId,
  onInlineEdit,
}: Props) {
  const needsSetup = !h.category || !h.time_minutes
  const hasRealMembership = !!h.membership_id
  const isCrossStore = !!h.origin_store_uuid && h.origin_store_uuid !== currentStoreUuid
  const confirmedName = h.external_name?.trim() || h.name?.trim()
  const hasName = !!confirmedName

  // ── Client-side context-aware match overlay (non-destructive) ──────
  // Only compute when this row is not already linked to a real hostess
  // membership (server truth wins). The helper is pure; empty pool or
  // empty name yields NONE which we treat as "no badge". Structured
  // candidate pool enables same-store / same-manager / activity /
  // recent-assignment bonuses; a plain string[] pool falls back to
  // name-only matching inside the helper.
  const nameMatch = !hasRealMembership && hasName && hostessNamePool && hostessNamePool.length > 0
    ? computeHostessMatch(
        confirmedName || "",
        hostessNamePool,
        {
          currentStoreUuid,
          // Prefer the participant's own manager when set; fall back to the
          // room-level dominant manager. Either may be null — that simply
          // drops the same-manager bonus inside the scorer.
          currentManagerMembershipId: h.manager_membership_id ?? currentManagerMembershipId ?? null,
        }
      )
    : null
  // Cross-store visibility redaction — UI MUST NOT expose store/manager/
  // activity details for cross-store suggestions. We still surface the
  // candidate name (needed to say "who we think this is") but wipe the
  // rest from what the tooltip displays.
  const nameMatchIsCrossStore = !!nameMatch?.best?.cross_store
  const nameMatchSuggested = nameMatch?.best?.candidate.name ?? null
  const nameMatchConflictCandidates =
    nameMatch?.state === "CONFLICT"
      ? nameMatch.top.map((s) => s.candidate.name)
      : []

  // ── Unresolved (setup needed) — keep compact single-row card ───────
  if (needsSetup) {
    return (
      <div
        onClick={() => onOpenEdit(h.id)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg cursor-pointer bg-white/[0.02] border border-dashed border-white/15 hover:border-white/25 transition-colors group"
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {hasName ? (
            <>
              <span className="text-[13px] font-semibold text-white/80 truncate">{confirmedName}</span>
              <span className="text-[10px] text-amber-400/80">미지정</span>
              {nameMatch && (
                <span
                  className={`text-[9px] px-1 py-px rounded font-semibold flex-shrink-0 ${
                    nameMatch.state === "EXACT"    ? "bg-emerald-500/25 text-emerald-300" :
                    nameMatch.state === "POSSIBLE" ? "bg-cyan-500/20 text-cyan-300" :
                    nameMatch.state === "CONFLICT" ? "bg-amber-500/25 text-amber-300" :
                                                     "bg-slate-500/20 text-slate-400"
                  }`}
                  title={
                    nameMatch.state === "POSSIBLE" && nameMatchSuggested
                      ? `제안: ${nameMatchSuggested}${nameMatchIsCrossStore ? " (타매장)" : ""}`
                      : nameMatch.state === "CONFLICT" && nameMatchConflictCandidates.length > 0
                      ? `후보: ${nameMatchConflictCandidates.join(", ")}`
                      : undefined
                  }
                >
                  {matchStateLabel(nameMatch.state)}
                  {nameMatch.state === "POSSIBLE" && nameMatchSuggested
                    ? ` · ${nameMatchSuggested}`
                    : ""}
                </span>
              )}
            </>
          ) : (
            <span className="text-[13px] text-slate-500 italic">탭하여 설정</span>
          )}
        </div>
        <input
          key={h.external_name ?? h.id}
          type="text"
          defaultValue={h.external_name ?? ""}
          placeholder="이름"
          onClick={(e) => e.stopPropagation()}
          onBlur={async (e) => { await onNameBlur(h.id, h.external_name, e.target.value) }}
          className="w-16 bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-cyan-500/40 flex-shrink-0"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(h.id) }}
          className="w-7 h-7 rounded-full bg-red-500/70 hover:bg-red-500 active:bg-red-600 text-white text-xs flex items-center justify-center flex-shrink-0 md:opacity-70 hover:opacity-100 transition-opacity"
          title="삭제"
        >✕</button>
      </div>
    )
  }

  // ── Operating (resolved) — 2-row compact ledger card ───────────────
  const displayCategory = h.category ?? ""
  const { baseCategory, baseUnitMinutes } = resolveBaseCategory(participants)
  const { elapsedMin, unitMinutes } = resolveParticipantElapsed(h, baseCategory, baseUnitMinutes, sessionStartedAt, now)
  const unitLabel = fmtUnitCount(elapsedMin, unitMinutes)
  const remMs = basis === "individual"
    ? remainingMsForParticipant(h, now, sessionStartedAt)
    : roomRemainingMs(participants, now, sessionStartedAt)
  const profit = profitMs(h, participants, now, sessionStartedAt)
  // 반티 판정: base unit의 절반과 경과시간 일치 여부
  const isBanti = elapsedMin === Math.floor(unitMinutes / 2)
  const priceAmount = h.price_amount ?? 0
  const enteredLabel = h.entered_at ? fmtTime(h.entered_at) : ""

  // 2026-04-25: 남은 시간 단계별 경고 레벨 4종.
  //   10분 이하 → 앰버 (경고)
  //   5분 이하 → 오렌지 (주의)
  //   3분 이하 → 빨강 + pulse (긴급)
  //   초과 (음수) → 진한 빨강 + 강한 pulse (연장 누락)
  const remMin = remMs / 60000
  const isOvertime = remMin < 0
  const isCritical = remMin >= 0 && remMin <= 3
  const isWarn5 = remMin > 3 && remMin <= 5
  const isWarn10 = remMin > 5 && remMin <= 10

  let urgencyClass = "bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08]"
  if (isOvertime) {
    urgencyClass = "bg-red-600/25 border-2 border-red-500 shadow-[0_0_16px_rgba(239,68,68,0.6)] animate-pulse"
  } else if (isCritical) {
    urgencyClass = "bg-red-500/20 border-2 border-red-500/70 shadow-[0_0_12px_rgba(248,113,113,0.4)] animate-pulse"
  } else if (isWarn5) {
    urgencyClass = "bg-orange-500/10 border border-orange-500/50 shadow-[0_0_8px_rgba(251,146,60,0.3)]"
  } else if (isWarn10) {
    urgencyClass = "bg-amber-500/10 border border-amber-500/40 shadow-[0_0_6px_rgba(251,191,36,0.2)]"
  }

  return (
    <div
      onClick={() => onToggle(h.id)}
      className={`relative w-full rounded-lg cursor-pointer transition-all group px-2.5 py-1.5 ${
        selected ? "bg-cyan-500/20 border border-cyan-500/40" : urgencyClass
      }`}
    >
    {/* ── Row 1: 이름 + 상태/배지 ───────────────────────────────── */}
<div className="flex items-center gap-1.5 min-w-0">
  {/* 소속 T (cross-store) */}
  {isCrossStore && (
    <span className="text-[9px] bg-amber-500 text-white px-1 py-px rounded font-bold flex-shrink-0" title="타매장">T</span>
  )}

  {/* 이름 */}
  {hasRealMembership ? (
    <span className="text-[13px] font-bold text-white truncate max-w-[7rem]">
      {confirmedName || "?"}
    </span>
  ) : (
    <input
      key={`name-${h.id}-${h.external_name ?? ""}`}
      type="text"
      defaultValue={h.external_name ?? ""}
      placeholder="이름"
      onClick={(e) => e.stopPropagation()}
      onBlur={async (e) => {
        await onNameBlur(h.id, h.external_name, e.target.value)
      }}
      className="text-[13px] font-bold text-white bg-transparent border-b border-dashed border-white/20 outline-none focus:border-cyan-400 w-[5rem] truncate px-0 py-0"
    />
  )}

  {/* 진행 badge */}
  <span className="text-[9px] px-1 py-px rounded bg-emerald-500/20 text-emerald-300 font-semibold flex-shrink-0">
    진행
  </span>

  {/* 반티 badge */}
  {isBanti && (
    <span className="text-[9px] px-1 py-px rounded bg-indigo-500/30 text-indigo-300 font-medium flex-shrink-0">
      반
    </span>
  )}

  {/* 초과 시간 */}
  {profit > 0 && (
    <span className="text-[9px] px-1 py-px rounded bg-emerald-500/25 text-emerald-300 font-medium flex-shrink-0">
      +{fmtMinutes(profit)}
    </span>
  )}

  {/* ❌ 여기 X 완전히 삭제됨 */}

  {/* ? 상태는 유지 (필요하니까) */}
  {h.match_status === "review_needed" && (
    <span
      className="text-[8px] bg-amber-500/80 text-white px-0.5 py-px rounded font-bold flex-shrink-0"
      title={h.match_candidates?.length ? `유사: ${h.match_candidates.join(", ")}` : ""}
    >
      ?
    </span>
  )}

  {/* name match overlay */}
  {nameMatch && (
    <span
      className={`text-[9px] px-1 py-px rounded font-semibold flex-shrink-0 ${
        nameMatch.state === "EXACT"
          ? "bg-emerald-500/25 text-emerald-300"
          : nameMatch.state === "POSSIBLE"
          ? "bg-cyan-500/20 text-cyan-300"
          : nameMatch.state === "CONFLICT"
          ? "bg-amber-500/25 text-amber-300"
          : "bg-slate-500/20 text-slate-400"
      }`}
    >
      {matchStateLabel(nameMatch.state)}
    </span>
  )}

  {/* 남은시간 — 클릭 시 종료 시각 편집 (end mode). */}
  {onInlineEdit ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onInlineEdit("end", h.id) }}
      className={`ml-auto text-[13px] font-bold flex-shrink-0 ${remainingColor(remMs)} hover:underline underline-offset-2`}
      title="종료 시각 수정"
    >
      {fmtRemaining(remMs)}
    </button>
  ) : (
    <span className={`ml-auto text-[13px] font-bold flex-shrink-0 ${remainingColor(remMs)}`}>
      {fmtRemaining(remMs)}
    </span>
  )}
</div>

      {/* ── Row 2: 실장(+소속) · 입실 ─────────────── 종목+단위 · 금액 ─── */}
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400 min-w-0">
        {/* 담당 실장 + (소속 매장) — 파싱된 매장 소속을 실장 옆에 그대로
            노출해서 운영자가 파싱 결과를 즉시 확인할 수 있게 한다.
            origin_store_name이 있을 때만 괄호를 렌더한다 (빈 괄호 금지). */}
        {/* 담당 실장 — 클릭 시 실장 교체 (manager mode). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (onInlineEdit) onInlineEdit("manager", h.id)
          }}
          disabled={!onInlineEdit}
          className="truncate max-w-[5.5rem] hover:underline underline-offset-2 text-left disabled:no-underline"
          title={h.manager_name ?? "실장 미지정"}
        >
          {h.manager_name ? (
            <span className="text-purple-300/80">{h.manager_name}</span>
          ) : (
            <span className="text-slate-500">실장 없음</span>
          )}
        </button>
        {/* 소속 매장 — 클릭 시 매장 교체 (store mode). origin_store_name
            이 없으면 편집 진입점이 안 보이지만, 여전히 버튼으로 감싸
            operator 가 "매장 지정" 같은 의도를 표현할 수 있다. */}
        {h.origin_store_name ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (onInlineEdit) onInlineEdit("store", h.id)
            }}
            disabled={!onInlineEdit}
            className="text-amber-300/90 hover:underline underline-offset-2 disabled:no-underline"
            title="소속 매장 변경"
          >
            ({h.origin_store_name})
          </button>
        ) : onInlineEdit ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onInlineEdit("store", h.id) }}
            className="text-slate-600 hover:text-amber-300/70 text-[10px]"
            title="소속 매장 지정"
          >(소속)</button>
        ) : null}
        <span className="text-slate-700">·</span>
        {/* 입실 시각 — 클릭 시 수정 (entered mode). */}
        {enteredLabel && (
          onInlineEdit ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onInlineEdit("entered", h.id) }}
              className="text-slate-400 hover:underline underline-offset-2"
              title="입실 시각 수정"
            >{enteredLabel}</button>
          ) : (
            <span className="text-slate-400">{enteredLabel}</span>
          )
        )}
        {/* 종목 + 단위 (개수) — 클릭 시 count mode (개수 ± 조정).
            기존 "종목/실장 변경" 통합 sheet로 연결되던 path는
            onOpenEdit 로 남겨두고 (hover 오버레이의 ✎ 버튼), 여기서는
            개수만 빠르게 조정한다. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (onInlineEdit) onInlineEdit("count", h.id)
            else onOpenEdit(h.id)
          }}
          className="ml-auto text-slate-300 hover:text-cyan-400 transition-colors truncate text-right"
          title={onInlineEdit ? "개수 조정" : "종목/실장 변경"}
        >
          {displayCategory}
          {unitLabel
            ? ` ${unitLabel}`
            : (Number(h.time_minutes) > 0 ? " 1개" : "")}
        </button>
        {/* 금액 */}
        <span className="text-[11px] font-semibold text-emerald-300 flex-shrink-0">
          {fmtWon(Number(priceAmount) || 0)}
        </span>
      </div>

      {/* ── Hover action overlay (compact) ────────────────────────── */}
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-[#0d1020]/90 rounded-lg px-1 py-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onOpenEdit(h.id) }}
          className="w-5 h-5 rounded-full bg-cyan-500/80 text-white text-[10px] flex items-center justify-center"
          title="티 변경"
        >✎</button>
        <button
          onClick={(e) => { e.stopPropagation(); onMidOut(h.id) }}
          className="w-5 h-5 rounded-full bg-red-500/80 text-white text-[10px] flex items-center justify-center"
          title={h.entered_at && Math.floor((now - new Date(h.entered_at).getTime()) / 60000) >= 12 ? "퇴실" : "팅김"}
        >✕</button>
      </div>
    </div>
  )
}
