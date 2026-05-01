"use client"

/**
 * Owner page 의 빠른 이동 그리드.
 *
 * 2026-05-01 R-OwnerNav-Folder: 갤럭시 폴더 패턴.
 *   기존 19개 평면 grid 는 인지부하 큼. 사용자 의견:
 *   "비슷한 상호작용하는 메뉴는 붙혀라."
 *
 * 구조:
 *   1) 즐겨찾기 (3 × 2 = 6개) — 매일 쓰는 핵심 (카운터/채팅/재무/배정/관제/보드)
 *   2) 폴더 (7개) — 카테고리별 묶음. 클릭 시 inline expand.
 *      장부 / 회원 / 리포트·감사 / 거래·외상 / 재고 / 운영설정 / 운영자(SA)
 *
 * UX:
 *   - 폴더 1개만 동시 open (다른 폴더 클릭 시 자동 close).
 *   - 채팅 미열람 배지는 즐겨찾기 "채팅" 타일에 그대로.
 *   - super_admin 폴더는 isSuperAdmin=true 일 때만 표시.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"

type NavItem = {
  label: string
  path: string
  icon: string
}

type Folder = {
  label: string
  icon: string
  items: NavItem[]
  requireSuperAdmin?: boolean
}

const FAVORITES: readonly NavItem[] = [
  { label: "카운터", path: "/counter", icon: "🖥️" },
  { label: "채팅", path: "/chat", icon: "💬" },
  { label: "재무", path: "/finance", icon: "💰" },
  { label: "배정", path: "/attendance", icon: "📋" },
  { label: "관제", path: "/admin", icon: "📡" },
  { label: "스태프 보드", path: "/staff-board", icon: "📋" },
]

const FOLDERS: readonly Folder[] = [
  {
    label: "장부",
    icon: "📑",
    items: [
      { label: "종이장부 (방별)", path: "/reconcile", icon: "📑" },
      { label: "스태프 장부", path: "/reconcile/staff", icon: "👥" },
    ],
  },
  {
    label: "회원",
    icon: "👥",
    items: [
      { label: "회원 생성", path: "/admin/members/create", icon: "➕" },
      { label: "가입 승인", path: "/admin/approvals", icon: "✓" },
      { label: "계정 관리", path: "/admin/members", icon: "👥" },
    ],
  },
  {
    label: "리포트·감사",
    icon: "📊",
    items: [
      { label: "리포트", path: "/reports", icon: "📊" },
      { label: "감사 로그", path: "/audit", icon: "📜" },
      { label: "감시 대시보드", path: "/ops/watchdog", icon: "🛡️" },
    ],
  },
  {
    label: "거래·외상",
    icon: "💰",
    items: [
      { label: "고객·외상", path: "/customers", icon: "👥" },
      { label: "이적 관리", path: "/transfer", icon: "🔄" },
      { label: "이슈 신고함", path: "/ops/issues", icon: "🐞" },
    ],
  },
  {
    label: "재고",
    icon: "📦",
    items: [
      { label: "재고", path: "/inventory", icon: "📦" },
    ],
  },
  {
    label: "운영 설정",
    icon: "⚙️",
    items: [
      { label: "운영 설정", path: "/ops", icon: "⚙️" },
    ],
  },
  {
    label: "운영자",
    icon: "🛡️",
    requireSuperAdmin: true,
    items: [
      { label: "전 매장 모니터", path: "/super-admin", icon: "🌐" },
      { label: "네트워크 맵", path: "/super-admin/visualize/network", icon: "🕸️" },
      { label: "학습 Corpus", path: "/admin/learn", icon: "🧠" },
    ],
  },
]

type Props = {
  chatUnread: number
  /** 사용자가 super_admin 인지. 비-super_admin 에게는 운영자 폴더 숨김. */
  isSuperAdmin?: boolean
}

export default function OwnerQuickNav({ chatUnread, isSuperAdmin = false }: Props) {
  const router = useRouter()
  const [openFolder, setOpenFolder] = useState<string | null>(null)

  const visibleFolders = FOLDERS.filter(
    (f) => !f.requireSuperAdmin || isSuperAdmin,
  )
  const expandedFolder = openFolder
    ? visibleFolders.find((f) => f.label === openFolder)
    : null

  return (
    <div className="space-y-4">
      {/* ─── 즐겨찾기 ────────────────────────────── */}
      <div>
        <div className="text-xs text-slate-400 mb-2 px-1">⭐ 즐겨찾기</div>
        <div className="grid grid-cols-3 gap-3">
          {FAVORITES.map((item) => (
            <Tile
              key={item.path}
              item={item}
              chatUnread={item.label === "채팅" ? chatUnread : 0}
              onClick={() => router.push(item.path)}
            />
          ))}
        </div>
      </div>

      {/* ─── 폴더 ────────────────────────────────── */}
      <div>
        <div className="text-xs text-slate-400 mb-2 px-1">📂 전체 메뉴</div>
        <div className="grid grid-cols-3 gap-3">
          {visibleFolders.map((folder) => {
            const isOpen = openFolder === folder.label
            const isSuperFolder = folder.requireSuperAdmin === true
            return (
              <button
                key={folder.label}
                onClick={() => setOpenFolder(isOpen ? null : folder.label)}
                className={`rounded-2xl border p-4 text-left transition-colors relative ${
                  isOpen
                    ? isSuperFolder
                      ? "border-fuchsia-500/40 bg-fuchsia-500/[0.12]"
                      : "border-cyan-500/40 bg-cyan-500/[0.12]"
                    : isSuperFolder
                      ? "border-fuchsia-500/20 bg-fuchsia-500/[0.04] hover:bg-fuchsia-500/[0.08]"
                      : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                }`}
                aria-expanded={isOpen}
              >
                <div className="text-xl mb-2">{folder.icon}</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">
                    {folder.label}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {folder.items.length}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── 펼쳐진 폴더 sub-menu (inline expand) ─── */}
      {expandedFolder && (
        <div
          className={`rounded-2xl border p-4 ${
            expandedFolder.requireSuperAdmin
              ? "border-fuchsia-500/30 bg-fuchsia-500/[0.06]"
              : "border-cyan-500/30 bg-cyan-500/[0.06]"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-200">
              {expandedFolder.icon} {expandedFolder.label}
            </span>
            <button
              onClick={() => setOpenFolder(null)}
              className="text-xs text-slate-400 hover:text-white"
              aria-label="폴더 닫기"
            >
              ✕ 닫기
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {expandedFolder.items.map((item) => (
              <Tile
                key={item.path}
                item={item}
                onClick={() => router.push(item.path)}
                small
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Tile — 단일 메뉴 타일.
//   small=true 면 폴더 sub-menu 안에 들어가는 작은 타일.
//   small=false 면 즐겨찾기/폴더 row 의 큰 타일.
// ─────────────────────────────────────────────────────────────

function Tile({
  item,
  chatUnread = 0,
  onClick,
  small = false,
}: {
  item: NavItem
  chatUnread?: number
  onClick: () => void
  small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border border-white/10 bg-white/[0.04] text-left hover:bg-white/[0.08] transition-colors relative ${
        small ? "p-3" : "p-4"
      }`}
    >
      <div className={small ? "text-base mb-1" : "text-xl mb-2"}>{item.icon}</div>
      {chatUnread > 0 && (
        <span className="absolute top-2 right-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {chatUnread > 99 ? "99+" : chatUnread}
        </span>
      )}
      <div
        className={
          small ? "text-xs font-medium text-slate-200" : "text-sm font-medium text-slate-200"
        }
      >
        {item.label}
      </div>
    </button>
  )
}
