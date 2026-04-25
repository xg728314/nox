"use client"

/**
 * CustomerCreditTabs — 고객관리 + 외상관리 공용 탭 헤더.
 *
 * 2026-04-25: "고객이 외상하는 것" 이라는 운영 철학에 따라 두 메뉴를
 *   시각적으로 한 묶음으로 묶는다. 두 페이지 (/customers, /credits) 는
 *   각각 로직을 유지하고 이 탭 바를 최상단에 배치해서 서로 네비게이션.
 *
 * 탭 클릭은 router.replace 로 history 스택을 더럽히지 않는다 (← 뒤로
 * 가 대시보드로 바로 돌아가게).
 */

import { useRouter } from "next/navigation"

type Tab = "customers" | "credits"

export default function CustomerCreditTabs({ active }: { active: Tab }) {
  const router = useRouter()

  const tabs: { key: Tab; label: string; path: string }[] = [
    { key: "customers", label: "고객", path: "/customers" },
    { key: "credits", label: "외상", path: "/credits" },
  ]

  return (
    <div className="px-4 pt-2 flex gap-2">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => {
            if (t.key === active) return
            router.replace(t.path)
          }}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
            active === t.key
              ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
              : "bg-white/[0.03] text-slate-400 border border-white/10 hover:bg-white/[0.06]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
