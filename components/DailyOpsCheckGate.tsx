"use client"

/**
 * ROUND-OPS-2 — Daily Ops Check Gate.
 *
 * 하루 1회 운영 체크 모달. 체크 완료 전까지 배경 전체를 가리고 클릭/스크롤
 * 차단. 체크 완료 시 `user_preferences(scope='daily_ops_check', store_uuid)`
 * 에 { date:today, checked:true } 저장 → 그 날은 재진입해도 뜨지 않음.
 *
 * 적용 대상: owner / manager
 *   super_admin 은 selective — profile.role 로만 판단 (global admin 은
 *   보통 별도 UX 라 스킵 대상).
 *
 * 적용 방식: 각 보호 페이지에서 `<DailyOpsCheckGate />` 를 JSX 루트에 한
 * 줄 삽입. overlay 는 position:fixed 이므로 children 을 래핑하지 않는다.
 *
 * store_uuid 정책 (FAIL 조건 대응):
 *   - per-store preference 로 저장. 한 사용자가 복수 매장에 걸쳐 있을 때
 *     각 매장별 "오늘 체크" 상태를 독립 유지.
 *   - profile.store_uuid 가 없으면 그냥 skip (비정상 상태 — 체크로 추가
 *     혼란 주지 않음).
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import {
  ensurePrefLoaded,
  getPrefSnapshot,
  subscribePref,
} from "@/app/counter/hooks/preferencesStore"
import {
  hasBlocking,
  hasWarning,
  listBlockingDetails,
  listWarningDetails,
  type AnomalyCounts,
} from "@/lib/ops/attendanceSeverity"

const SCOPE = "daily_ops_check"
type PrefPayload = { date?: unknown; checked?: unknown }
const subscribeFn = (l: () => void) => subscribePref(SCOPE, l)
const snapshotFn = () => getPrefSnapshot<PrefPayload>(SCOPE)

// KST 기준 오늘 날짜 (YYYY-MM-DD). business_day 와 같은 날짜 체계 사용.
function todayInKst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
}

type OpsSummary = {
  anomalies: AnomalyCounts
  attendance: { checked_in: number; total: number }
  ble: { live_count: number }
  business_day_id: string | null
}

export default function DailyOpsCheckGate() {
  const profile = useCurrentProfile()
  const role = profile?.role ?? null
  const storeUuid = profile?.store_uuid ?? null

  // mount 후에만 계산 (hydration 일관성)
  const [today, setToday] = useState<string>("")
  const [checkedToday, setCheckedToday] = useState<boolean | null>(null) // null = 판정 전
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [summary, setSummary] = useState<OpsSummary | null>(null)

  // 체크리스트 4개 state
  const [cBizDay, setCBizDay] = useState(false)
  const [cAttendance, setCAttendance] = useState(false)
  const [cBle, setCBle] = useState(false)
  const [cNoAnomaly, setCNoAnomaly] = useState(false)

  const appliesToRole = role === "owner" || role === "manager"

  // 2026-05-01 R-Counter-Speed v2: 직접 apiFetch 하던 것을 preferencesStore
  //   기반으로 재작성. bootstrap 가 hydrate 한 슬롯을 그대로 사용해 중복
  //   /api/me/preferences?scope=daily_ops_check (3-6초 cold compile) 제거.
  //   useSyncExternalStore 로 store snapshot 구독, 응답 변경 시 자동 rerender.
  useEffect(() => {
    if (!appliesToRole || !storeUuid) return
    setToday(todayInKst())
    ensurePrefLoaded<PrefPayload>(SCOPE)
  }, [appliesToRole, storeUuid])

  const prefSnap = useSyncExternalStore(subscribeFn, snapshotFn, snapshotFn)
  // snapshot.loaded → checkedToday 도출. 미로딩 동안 null 유지 (깜박임 방지).
  useEffect(() => {
    if (!appliesToRole || !storeUuid) return
    if (!prefSnap.loaded) return
    const t = todayInKst()
    const perStore = prefSnap.resp?.per_store ?? {}
    const cfg = perStore[storeUuid]
    const done =
      !!cfg &&
      typeof cfg.date === "string" &&
      cfg.date === t &&
      cfg.checked === true
    setCheckedToday(done)
  }, [appliesToRole, storeUuid, prefSnap])

  // ── (2) 오늘 ops summary (옵션) 로드: 모달 떠야 할 때만 ──
  useEffect(() => {
    if (checkedToday !== false) return
    ;(async () => {
      try {
        const res = await apiFetch("/api/ops/attendance-overview")
        if (!res.ok) return
        const d = (await res.json()) as OpsSummary
        setSummary(d)
      } catch { /* ignore */ }
    })()
  }, [checkedToday])

  // ── (3) 모달 active 동안 body scroll lock ─────────────────
  const active =
    appliesToRole && !!storeUuid && checkedToday === false
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])

  if (!appliesToRole || !storeUuid) return null
  if (checkedToday === null) return null // 로딩 중에는 무표시 (깜박임 방지)
  if (checkedToday === true) return null

  // ROUND-OPS-3: blocking / warn 판정은 공용 helper.
  //   blocking 이면 [확인 완료] 버튼 자체를 막는다 (체크박스만으로 통과 불가).
  const anomalyCounts: AnomalyCounts = summary?.anomalies ?? {
    duplicate_open: 0,
    recent_checkout_block: 0,
    tag_mismatch: 0,
    no_business_day: 0,
  }
  const blocking = summary ? hasBlocking(anomalyCounts) : false
  const warning = summary ? hasWarning(anomalyCounts) : false
  const blockingList = summary ? listBlockingDetails(anomalyCounts) : []
  const warningList = summary ? listWarningDetails(anomalyCounts) : []

  // 2026-04-30 fix: 영업일 미개방은 사람 (BLE) 유무와 무관하게 체크 모달의
  //   "조치 필요" 신호로 표기. 기존 anomaly 분류는 BLE 사람 있을 때만
  //   no_business_day>0 으로 잡혀서 (cron 알림 임계치) 사람 없는 시간대엔
  //   "✓ 이상 없음" 으로 잘못 표시되던 문제 보정. anomaly 분류 자체는
  //   변경하지 않음 — 모달 UI 만 보정.
  const noBizDay = !!summary && !summary.business_day_id

  const allChecked = cBizDay && cAttendance && cBle && cNoAnomaly
  const canSubmit = allChecked && !blocking && !submitting && summary !== null

  async function submit() {
    if (!canSubmit || !storeUuid) return
    setSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/me/preferences", {
        method: "PUT",
        body: JSON.stringify({
          scope: "daily_ops_check",
          store_uuid: storeUuid,
          layout_config: { date: today, checked: true },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.message || body?.error || "저장 실패")
        return
      }
      setCheckedToday(true)
    } catch {
      setError("네트워크 오류")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      // 모든 포인터 이벤트 흡수 — 배경 클릭 차단
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-pink-400/25 bg-[#0A1222] p-5 space-y-4">
        <div>
          <div className="text-xs text-slate-400">{today}</div>
          <h2 className="text-lg font-semibold text-pink-100">오늘 운영 체크</h2>
          <p className="text-[11px] text-slate-500 mt-1">
            모든 항목 확인 후 [확인 완료] 를 눌러야 메인 기능을 사용할 수 있습니다.
          </p>
        </div>

        {summary && (
          <div
            className={
              "rounded-lg border px-3 py-2 text-[12px] " +
              (blocking
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : (warning || noBizDay)
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200")
            }
          >
            <div className="flex items-center justify-between">
              <span>
                영업일:{" "}
                {summary.business_day_id ? "열림" : <span className="text-red-300">미개방</span>}
                · 출근 {summary.attendance.checked_in}/{summary.attendance.total}
                · BLE {summary.ble.live_count}
              </span>
              <Link
                href="/ops/attendance"
                className="text-[11px] text-sky-300 hover:underline ml-2"
              >
                대시보드 →
              </Link>
            </div>

            {/* ROUND-OPS-3: blocking 이면 빨간 차단 배너, warn 이면 주황 배너 */}
            {blocking ? (
              <div className="mt-1.5 space-y-0.5">
                <div className="text-[11px] font-semibold">
                  🚫 운영 차단: 아래 문제를 먼저 해결하세요.
                </div>
                {blockingList.map((d) => (
                  <div key={d.type} className="text-[11px] opacity-90">
                    · {d.label} {d.count}건
                  </div>
                ))}
                {warning && warningList.length > 0 && (
                  <div className="text-[10px] opacity-70 mt-1">
                    (경고: {warningList.map((w) => `${w.label} ${w.count}`).join(", ")})
                  </div>
                )}
              </div>
            ) : warning ? (
              <div className="mt-1.5 space-y-0.5">
                <div className="text-[11px] font-semibold">
                  ⚠ 주의: BLE/퇴근 관련 경고가 있습니다. 확인 후 진행하세요.
                </div>
                {warningList.map((d) => (
                  <div key={d.type} className="text-[11px] opacity-90">
                    · {d.label} {d.count}건
                  </div>
                ))}
                {noBizDay && (
                  <div className="text-[11px] opacity-90">· 영업일 미개방</div>
                )}
              </div>
            ) : noBizDay ? (
              <div className="mt-1.5 space-y-0.5">
                <div className="text-[11px] font-semibold">
                  ⚠ 영업일 미개방
                </div>
                <div className="text-[11px] opacity-90">
                  영업 시작 전이라면 정상. 영업 중인데 미개방이면 [운영 메뉴 → 영업일 마감/개방] 에서 처리하세요.
                </div>
              </div>
            ) : (
              <div className="mt-1 text-[11px] opacity-80">✓ 이상 없음</div>
            )}
          </div>
        )}

        <ul className="space-y-2">
          <CheckItem
            label="business_day 열림 확인"
            checked={cBizDay}
            onToggle={() => setCBizDay(!cBizDay)}
          />
          <CheckItem
            label="출근 인원 정상"
            checked={cAttendance}
            onToggle={() => setCAttendance(!cAttendance)}
          />
          <CheckItem
            label="BLE 감지 정상"
            checked={cBle}
            onToggle={() => setCBle(!cBle)}
          />
          <CheckItem
            label="이상 없음 확인"
            checked={cNoAnomaly}
            onToggle={() => setCNoAnomaly(!cNoAnomaly)}
          />
        </ul>

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          title={
            blocking
              ? "운영 차단: 중복 출근 또는 영업일 미개방 문제를 먼저 해결하세요."
              : !allChecked
              ? "모든 체크 항목을 확인하세요."
              : ""
          }
          className={
            "w-full h-11 rounded-xl text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed " +
            (blocking
              ? "bg-red-500/15 text-red-200 border-red-500/40"
              : "bg-pink-500/25 text-pink-100 border-pink-500/40")
          }
        >
          {submitting
            ? "저장 중..."
            : blocking
            ? "운영 차단 — 진행 불가"
            : "확인 완료"}
        </button>

        <p className="text-[10px] text-slate-500 text-center">
          이 체크는 {today} 오늘 하루만 유효합니다. 내일 다시 체크해야 합니다.
        </p>
      </div>
    </div>
  )
}

function CheckItem({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
          checked
            ? "bg-emerald-500/15 text-emerald-100 border-emerald-500/30"
            : "bg-white/[0.03] text-slate-300 border-white/10 hover:bg-white/[0.06]"
        }`}
      >
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[12px] ${
            checked
              ? "bg-emerald-500 text-black border-emerald-400"
              : "bg-transparent text-transparent border-slate-500"
          }`}
        >
          ✓
        </span>
        <span>{label}</span>
      </button>
    </li>
  )
}
