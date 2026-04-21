"use client"

/**
 * /m/monitor/store/[store_uuid] — 단일 매장 상세.
 *
 * 섹션 순서 (태스크 §Phase 5):
 *   ① MobileMiniMap     — 세로 배치 미니맵 (BLE 없어도 정상 렌더)
 *   ② 실시간 위치 현황   — participants 기반 리스트
 *   ③ 이탈 알림         — mid_out participants
 *   ④ 최근 이동 이벤트   — data.movement
 *   ⑤ 층 요약 (super_admin only) — FloorSummaryCard
 *
 * 데이터 소스: Phase 3 신 API `useScopedMonitor(\`store-<uuid>\`)`.
 * mock 없음. BLE 없을 때도 모든 섹션이 빈 상태로 렌더.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useScopedMonitor } from "@/app/counter/monitor/hooks/useMonitorData"
import { useDeviceMode } from "@/lib/ui/useDeviceMode"
import MobileMiniMap from "../../components/MobileMiniMap"
import MobileHostessActionSheet, { type ActionSubject } from "../../components/MobileHostessActionSheet"
import LocationCorrectionSheet, { type CorrectionTarget } from "../../components/LocationCorrectionSheet"
import MovementHistorySheet from "../../components/MovementHistorySheet"
import FloorSummaryCard from "../../components/FloorSummaryCard"

type MeResponse = {
  user_id: string
  store_uuid: string
  is_super_admin?: boolean
}

export default function MobileStorePage() {
  const params = useParams<{ store_uuid: string }>()
  const router = useRouter()
  const device = useDeviceMode("mobile")
  const storeUuid = params?.store_uuid ?? ""

  const { data, loading, error, lastUpdatedAt, refresh } =
    useScopedMonitor(storeUuid ? `store-${storeUuid}` : "mine")

  // super_admin flag — drives the "층 요약" (⑤) rendering only.
  const [isSuper, setIsSuper] = useState<boolean>(false)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/auth/me", { credentials: "include" })
        if (!r.ok || cancelled) return
        const j = await r.json() as MeResponse
        if (!cancelled) setIsSuper(!!j.is_super_admin)
      } catch { /* ignore */ }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const rooms = useMemo(() => data?.rooms ?? [], [data])
  const blePresence = useMemo(() => data?.ble?.presence ?? [], [data])
  const movement = useMemo(() => data?.movement ?? [], [data])
  const summary = data?.summary ?? { present: 0, mid_out: 0, restroom: 0, external_floor: 0, waiting: 0 }

  // Action sheet flow
  const [actionOpen, setActionOpen] = useState(false)
  const [actionSubject, setActionSubject] = useState<ActionSubject | null>(null)
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)

  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyMid, setHistoryMid] = useState<string | null>(null)
  const [historyName, setHistoryName] = useState<string | null>(null)

  const onSelectParticipant = useCallback((args: {
    participant_id: string; membership_id: string | null; room_uuid: string | null; display_name: string
  }) => {
    setSelectedParticipantId(args.participant_id)
    // Build current-location text for action sheet header.
    const room = rooms.find(r => r.room_uuid === args.room_uuid)
    const loc = room ? `${room.room_name}${room.floor_no ? ` (${room.floor_no}F)` : ""}` : "—"
    setActionSubject({
      participant_id: args.participant_id,
      membership_id: args.membership_id,
      room_uuid: args.room_uuid,
      display_name: args.display_name,
      current_location_text: loc,
    })
    setActionOpen(true)
  }, [rooms])

  const openCorrection = useCallback(() => {
    if (!actionSubject?.membership_id) return
    const room = rooms.find(r => r.room_uuid === actionSubject.room_uuid)
    const ble = blePresence.find(p => p.membership_id === actionSubject.membership_id) ?? null
    setCorrectionTarget({
      participant_id: actionSubject.participant_id,
      membership_id: actionSubject.membership_id,
      display_name: actionSubject.display_name,
      detected: {
        store_uuid: data?.store_uuid ?? null,
        store_name: null,
        room_uuid: ble?.room_uuid ?? actionSubject.room_uuid,
        room_no: room?.room_no ?? null,
        zone: ble?.zone ?? (room ? "room" : "unknown"),
        floor: room?.floor_no ?? null,
      },
    })
    setActionOpen(false)
    setCorrectionOpen(true)
  }, [actionSubject, rooms, blePresence, data?.store_uuid])

  const openHistory = useCallback(() => {
    if (!actionSubject?.membership_id) return
    setHistoryMid(actionSubject.membership_id)
    setHistoryName(actionSubject.display_name)
    setActionOpen(false)
    setHistoryOpen(true)
  }, [actionSubject])

  const absenceList = useMemo(() => {
    const out: Array<{ id: string; display_name: string; room_name: string; since: string }> = []
    for (const r of rooms) {
      for (const p of r.participants) {
        if ((p.status === "mid_out" || p.zone === "mid_out") && p.operator_status !== "ended") {
          out.push({
            id: p.id,
            display_name: p.display_name,
            room_name: r.room_name,
            since: p.entered_at,
          })
        }
      }
    }
    return out
  }, [rooms])

  const homeFloor = useMemo(() => {
    for (const r of rooms) if (r.floor_no != null) return r.floor_no
    return null
  }, [rooms])

  return (
    <>
      {device === "ops" && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/25 text-amber-200 text-[11px] flex items-center gap-2">
          <span>🖥 큰 화면이 감지되었습니다 — 데스크톱 뷰 권장</span>
          <Link
            href="/counter/monitor"
            className="ml-auto px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 font-semibold"
          >
            카운터 모니터로 이동
          </Link>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#07091A]/95 backdrop-blur border-b border-white/[0.07] px-3 py-2 flex items-center gap-2">
        <button onClick={() => router.push("/m/monitor")} className="text-slate-400 text-[13px]">← 탭</button>
        <span className="text-[12px] font-bold text-slate-100 truncate">
          매장 {storeUuid.slice(0, 8)}…
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${
            error ? "bg-red-400" : loading ? "bg-amber-300 animate-pulse" : "bg-emerald-400"
          }`} aria-hidden />
          <span className="text-[10px] text-slate-500 tabular-nums">
            {lastUpdatedAt ? lastUpdatedAt.slice(11, 19) : "—"}
          </span>
          <button onClick={() => void refresh()} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 text-slate-400" title="새로고침">⟳</button>
        </span>
      </header>

      <main className="p-3 space-y-3 text-[13px]">
        {/* Error / empty banners */}
        {error && (
          <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">
            ⚠ {error}
          </div>
        )}
        {!error && !loading && rooms.length === 0 && (
          <div className="text-slate-500 text-[12px] py-6 text-center">
            이 매장에 활성 데이터가 없습니다.
          </div>
        )}

        {/* ① MiniMap */}
        <section>
          <MobileMiniMap
            rooms={rooms}
            blePresence={blePresence}
            selectedParticipantId={selectedParticipantId}
            onSelectParticipant={onSelectParticipant}
          />
        </section>

        {/* ② 실시간 위치 현황 (summary) */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
          <h2 className="text-[11px] font-bold text-slate-300 mb-2">실시간 위치 현황</h2>
          <div className="grid grid-cols-5 gap-2 text-[11px]">
            <Stat label="재실" value={summary.present} tone="cyan" />
            <Stat label="이탈" value={summary.mid_out} tone="amber" />
            <Stat label="화장실" value={summary.restroom} tone="amber" />
            <Stat label="타층" value={summary.external_floor} tone="slate" />
            <Stat label="대기" value={summary.waiting} tone="slate" />
          </div>
          {blePresence.length === 0 && (
            <div className="mt-2 text-[10px] text-slate-500">BLE 신호 없음. participant 기반으로만 표시 중.</div>
          )}
        </section>

        {/* ③ 이탈 알림 */}
        <section className="rounded-xl border border-amber-500/20 bg-[#0b0e1c] p-3">
          <h2 className="text-[11px] font-bold text-amber-200 mb-2">이탈 알림</h2>
          {absenceList.length === 0 ? (
            <div className="text-slate-500 text-[11px]">현재 이탈 인원 없음.</div>
          ) : (
            <ul className="space-y-1">
              {absenceList.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-200 font-semibold">{a.display_name}</span>
                  <span className="text-slate-500">{a.room_name}</span>
                  <span className="ml-auto text-[10px] text-slate-500 tabular-nums">{a.since.slice(11, 16)} 이후</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ④ 최근 이동 이벤트 */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3">
          <h2 className="text-[11px] font-bold text-slate-300 mb-2">최근 이동 이벤트</h2>
          {movement.length === 0 ? (
            <div className="text-slate-500 text-[11px]">최근 30분 내 이동 이벤트 없음.</div>
          ) : (
            <ol className="space-y-1 text-[11px]">
              {movement.slice(0, 20).map((m, i) => (
                <li key={i} className="flex items-center gap-2 border-b border-white/[0.04] pb-1">
                  <span className="text-slate-500 tabular-nums w-[44px]">{m.at.slice(11, 16)}</span>
                  <span className="text-slate-300">{m.kind}</span>
                  {m.actor_role && <span className="text-[9px] text-slate-500">· {m.actor_role}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ⑤ 층 요약 (super_admin only) */}
        {isSuper && homeFloor != null && (
          <FloorSummaryCard floor={homeFloor} />
        )}
      </main>

      {/* Bottom sheets — rendered at root for z-index isolation */}
      <MobileHostessActionSheet
        open={actionOpen}
        subject={actionSubject}
        onClose={() => setActionOpen(false)}
        onViewLocation={() => { setActionOpen(false) /* info-only, already shown in mini map */ }}
        onCorrect={openCorrection}
        onHistory={openHistory}
      />
      <LocationCorrectionSheet
        open={correctionOpen}
        target={correctionTarget}
        onClose={() => setCorrectionOpen(false)}
        onSuccess={() => { void refresh() }}
      />
      <MovementHistorySheet
        open={historyOpen}
        membershipId={historyMid}
        displayName={historyName}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  )
}

// ── helpers ──
function Stat({ label, value, tone }: { label: string; value: number; tone: "cyan" | "amber" | "slate" }) {
  const cls =
    tone === "cyan"  ? "text-cyan-300" :
    tone === "amber" ? "text-amber-300" :
                       "text-slate-200"
  return (
    <div className="rounded-md bg-white/[0.03] border border-white/[0.06] px-2 py-1.5">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}

