"use client"

/**
 * CounterSettingsModal — Phase D. 방 카드 레이아웃 / 사이드바 메뉴
 * 커스터마이징 진입점. 두 에디터를 탭으로 묶고, 각각이 자체 ScopeSelector
 * + 저장/취소/기본값 버튼을 보유한다.
 *
 * 모달 자체는 fetch 를 하지 않음 — 자식 훅(useRoomLayout / useMenuConfig)
 * 이 mount 될 때 본인 scope 로 GET 한다. 닫힘 상태에서는 unmount 되므로
 * 열릴 때마다 최신 값을 가져온다.
 */

import { useState } from "react"
import type { CounterMenuRole } from "@/lib/counter/menu"
import RoomLayoutEditor from "./RoomLayoutEditor"
import SidebarLayoutEditor from "./SidebarLayoutEditor"

type Tab = "room" | "sidebar"

type Props = {
  open: boolean
  onClose: () => void
  role: CounterMenuRole | null
  storeUuid: string | null
  /** super-admin 여부 — 전역 강제 override 조작용. 미제공 시 false. */
  isSuperAdmin?: boolean
}

export default function CounterSettingsModal({
  open, onClose, role, storeUuid, isSuperAdmin = false,
}: Props) {
  const [tab, setTab] = useState<Tab>("room")

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[90vh] rounded-2xl bg-[#0d1020] border border-white/10 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-200">커스터마이징</span>
            <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/10 p-1">
              {([
                { id: "room" as Tab,    label: "방 레이아웃" },
                { id: "sidebar" as Tab, label: "사이드바 메뉴" },
              ]).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 rounded-md text-[11px] font-semibold ${
                    tab === t.id
                      ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >{t.label}</button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto min-h-0">
          {tab === "room" ? (
            <RoomLayoutEditor
              storeUuid={storeUuid}
              role={role}
              isSuperAdmin={isSuperAdmin}
              onClose={onClose}
            />
          ) : (
            <SidebarLayoutEditor
              role={role}
              storeUuid={storeUuid}
              isSuperAdmin={isSuperAdmin}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}
