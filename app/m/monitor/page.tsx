"use client"

/**
 * /m/monitor — 모바일 모니터 엔트리.
 *
 * 동작:
 *   1. 1차 탭: 내소속 / 5F / 6F / 7F / 8F (전체층 없음).
 *      - 내소속 탭은 현재 매장 store 페이지로 자동 redirect.
 *      - 5F/6F/7F/8F 탭은 StoreListSheet 를 슬라이드업.
 *   2. 탭/마지막 매장 state 는 localStorage 에 저장 (뒤로가기/재방문 복원).
 *   3. 960px 이상 뷰포트로 진입하면 "PC 뷰 권장" 배너 + 이동 버튼 (강제
 *      리다이렉트는 Phase 6 의 /monitor 라우터에 맡김).
 *
 * 실 API 만 호출. mock 없음.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import { useDeviceMode } from "@/lib/ui/useDeviceMode"
import MobileTopTabs, { type MobileTab } from "./components/MobileTopTabs"
import StoreListSheet from "./components/StoreListSheet"

const LS_TAB = "nox.mobile.monitor.tab"
const LS_LAST_STORE = "nox.mobile.monitor.store_uuid"
const LS_LAST_FLOOR = "nox.mobile.monitor.floor"

type MeResponse = {
  user_id: string
  store_uuid: string
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  is_super_admin?: boolean
}

function readLS(k: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(k) : null } catch { return null }
}
function writeLS(k: string, v: string) {
  try { window.localStorage.setItem(k, v) } catch {}
}

export default function MobileMonitorPage() {
  const router = useRouter()
  const device = useDeviceMode("mobile")

  // Profile — needed for (a) "내소속" redirect target, (b) super_admin detection,
  // (c) per-role tab filtering.
  const [profile, setProfile] = useState<MeResponse | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [myFloor, setMyFloor] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await apiFetch("/api/auth/me")
        if (!r.ok) {
          if (!cancelled) setProfileError(`${r.status} — 로그인이 필요합니다.`)
          return
        }
        const json = await r.json() as MeResponse
        if (!cancelled) setProfile(json)

        // Infer myFloor from caller's store rooms via scope=mine.
        const sr = await apiFetch("/api/monitor/scope?scope=mine")
        if (!cancelled && sr.ok) {
          const sj = await sr.json() as { stores: Array<{ floor_no: number | null }> }
          const f = sj.stores?.[0]?.floor_no ?? null
          setMyFloor(f)
        }
      } catch (e) {
        if (!cancelled) setProfileError(e instanceof Error ? e.message : "network error")
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Tab state
  const [tab, setTab] = useState<MobileTab>("mine")
  useEffect(() => {
    const saved = readLS(LS_TAB) as MobileTab | null
    if (saved === "mine" || saved === "5F" || saved === "6F" || saved === "7F" || saved === "8F") {
      setTab(saved)
    }
  }, [])

  // Sheet state (for floor tabs)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetFloor, setSheetFloor] = useState<number | null>(null)

  const onSelectTab = useCallback((t: MobileTab) => {
    setTab(t); writeLS(LS_TAB, t)
    if (t === "mine") {
      // Redirect to own store page.
      if (profile?.store_uuid) {
        writeLS(LS_LAST_STORE, profile.store_uuid)
        router.push(`/m/monitor/store/${profile.store_uuid}`)
      }
      // If profile not yet loaded, stay on this page — a banner below guides.
      return
    }
    const floorNo = Number(t.replace("F", ""))
    writeLS(LS_LAST_FLOOR, String(floorNo))
    setSheetFloor(floorNo)
    setSheetOpen(true)
  }, [profile?.store_uuid, router])

  const onSelectStore = useCallback((storeUuid: string) => {
    writeLS(LS_LAST_STORE, storeUuid)
    setSheetOpen(false)
    router.push(`/m/monitor/store/${storeUuid}`)
  }, [router])

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

      <MobileTopTabs
        active={tab}
        onSelect={onSelectTab}
        isSuperAdmin={!!profile?.is_super_admin}
        myFloor={myFloor}
      />

      <main className="p-3 text-[13px]">
        {profileError && (
          <div className="text-red-300 text-[12px] bg-red-500/10 border border-red-500/25 rounded-md px-3 py-2">
            ⚠ {profileError}
          </div>
        )}
        {!profile && !profileError && (
          <div className="text-slate-500 text-[12px] py-10 text-center">프로필 로드 중…</div>
        )}
        {profile && tab === "mine" && (
          <div className="text-slate-400 text-[12px] py-6 text-center">
            내 가게로 이동 중…
            <div className="mt-2">
              <Link
                href={`/m/monitor/store/${profile.store_uuid}`}
                className="inline-block px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[12px]"
              >
                {profile.store_uuid.slice(0, 8)}… 열기
              </Link>
            </div>
          </div>
        )}
        {profile && tab !== "mine" && !sheetOpen && (
          <div className="text-slate-500 text-[12px] py-10 text-center">
            {tab} 매장을 선택하세요.
            <div className="mt-2">
              <button
                onClick={() => { setSheetOpen(true) }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300"
              >
                매장 목록 열기
              </button>
            </div>
          </div>
        )}
      </main>

      <StoreListSheet
        open={sheetOpen}
        floor={sheetFloor}
        onClose={() => setSheetOpen(false)}
        onSelectStore={onSelectStore}
      />
    </>
  )
}
