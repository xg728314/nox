"use client"

/**
 * MobileTopTabs — 1차 탭 (내소속 + 5F/6F/7F/8F). 전체층 탭 없음.
 *
 * Role 기반 필터링:
 *   - super_admin: 모든 탭 노출
 *   - 그 외: "내소속" + 내 매장 floor 1개만
 *
 * 내 매장 floor 는 `myFloor` prop 으로 상위에서 전달. null 이면 floor
 * 탭 숨김(로딩 중 또는 조회 실패).
 */

export type MobileTab = "mine" | "5F" | "6F" | "7F" | "8F"

type Props = {
  active: MobileTab
  onSelect: (tab: MobileTab) => void
  isSuperAdmin: boolean
  myFloor: number | null
}

const ALL_FLOORS: Array<{ id: MobileTab; label: string; floorNo: number }> = [
  { id: "5F", label: "5F", floorNo: 5 },
  { id: "6F", label: "6F", floorNo: 6 },
  { id: "7F", label: "7F", floorNo: 7 },
  { id: "8F", label: "8F", floorNo: 8 },
]

export default function MobileTopTabs({ active, onSelect, isSuperAdmin, myFloor }: Props) {
  const visibleFloors = isSuperAdmin
    ? ALL_FLOORS
    : ALL_FLOORS.filter(f => f.floorNo === myFloor)

  return (
    <nav
      className="sticky top-0 z-20 bg-[#07091A]/95 backdrop-blur border-b border-white/[0.07]"
      aria-label="위치 범위 탭"
    >
      <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto">
        <TabButton active={active === "mine"} onClick={() => onSelect("mine")}>내소속</TabButton>
        {visibleFloors.map(f => (
          <TabButton
            key={f.id}
            active={active === f.id}
            onClick={() => onSelect(f.id)}
          >
            {f.label}
          </TabButton>
        ))}
        {!isSuperAdmin && myFloor == null && (
          <span className="ml-1 text-[10px] text-slate-600">층 정보 로드 중…</span>
        )}
      </div>
    </nav>
  )
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
        active
          ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-100"
          : "bg-white/[0.03] border-white/10 text-slate-300"
      }`}
    >
      {children}
    </button>
  )
}
