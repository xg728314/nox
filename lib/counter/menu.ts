/**
 * COUNTER_MENU — Phase C manifest of counter sidebar menu items.
 *
 * 단일 원본. role 필터와 사용자 override(order/hidden) 를 적용하기 위한
 * 메타데이터를 보관한다. 실제 렌더는 CounterSidebar 가 한다.
 *
 * role 필터는 **항상 먼저** 적용된다 — 사용자 설정이 role 제한을
 * 우회할 수 없다. 이건 middleware.ts 역할 매트릭스 + 각 페이지 가드와
 * 동일한 정책이며, 사용자 preferences 가 보안 결정을 되돌리게 두면
 * 안 된다.
 *
 * MenuItemId 는 saved preferences JSON 과의 contract 이므로 변경하면
 * 기존 설정이 호환 안 된다. 추가는 자유 — 미지정 id 는 forward-compat
 * 로 무시된다.
 */

export type CounterMenuRole = "owner" | "manager" | "waiter" | "staff" | "hostess"

export type MenuItemId =
  | "counter"
  | "customers"
  | "inventory"
  | "reports"
  | "payouts"
  | "settlement_history"
  | "owner_home"
  | "manager_home"
  | "staff"
  | "chat"
  | "watchdog"
  | "issues"
  | "help"
  | "me"
  | "security"
  | "reconcile"

export type MenuItemDefinition = {
  id: MenuItemId
  label: string
  icon: string
  path: string
  /** 비어있거나 undefined → 모든 role 허용. 명시되면 해당 role 만 허용. */
  requiredRoles?: ReadonlyArray<CounterMenuRole>
  /** togglable=false → 사용자가 hidden 에 넣어도 보이게 유지. Phase C
   *  에서는 "카운터" 만 필수 (현 위치 랜딩). */
  togglable: boolean
}

// Order 는 현재 CounterSidebar 의 기존 렌더 순서와 동일.
export const COUNTER_MENU: readonly MenuItemDefinition[] = [
  {
    id: "counter",  label: "카운터",   icon: "⊞", path: "/counter",
    togglable: false,
  },
  {
    id: "customers", label: "고객·외상", icon: "👥", path: "/customers",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
  {
    id: "inventory", label: "재고관리", icon: "📦", path: "/inventory",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
  // 2026-04-25: 상세 매출표 (일일/스태프/실장 탭). owner 전용 (middleware 가드).
  {
    id: "reports",   label: "상세매출", icon: "📊", path: "/reports",
    requiredRoles: ["owner"],
    togglable: true,
  },
  // 2026-04-25: "정산" 라벨이 여러 페이지에 중복돼 있어서 역할별로 명확하게
  //   차별화. 이건 정산 **트리** (실장 → 스태프 드릴다운) 로 이름 변경.
  {
    id: "payouts",   label: "정산 트리",  icon: "💰", path: "/payouts/settlement-tree",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
  // 2026-04-25: 정산 이력 — owner/manager 공통으로 자주 조회.
  {
    id: "settlement_history", label: "정산 이력", icon: "📒", path: "/settlement/history",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
  {
    id: "owner_home", label: "매장관리", icon: "🏪", path: "/owner",
    requiredRoles: ["owner"],
    togglable: true,
  },
  // 2026-04-25: manager 전용 홈. 이전엔 사이드바에 없어서 실장이 카운터
  //   에서 자기 대시보드로 돌아갈 수 없었음.
  {
    id: "manager_home", label: "실장 홈", icon: "🪪", path: "/manager",
    requiredRoles: ["manager"],
    togglable: true,
  },
  {
    id: "staff",     label: "스태프",   icon: "👤", path: "/staff",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
  // 2026-04-25: 채팅 — 룸/DM/글로벌. 모든 role 이 접근.
  {
    id: "chat", label: "채팅", icon: "💬", path: "/chat",
    togglable: true,
  },
  // 2026-04-25: 감시 대시보드 — owner 전용. 실시간 이상 징후 한눈에.
  {
    id: "watchdog", label: "감시", icon: "🛡️", path: "/ops/watchdog",
    requiredRoles: ["owner"],
    togglable: true,
  },
  // 2026-04-25: 이슈 트리아지 — owner 전용. 사용자 신고 처리.
  {
    id: "issues", label: "이슈 신고함", icon: "🐞", path: "/ops/issues",
    requiredRoles: ["owner"],
    togglable: true,
  },
  // 2026-04-25: 사용 가이드 — role 별 자주 쓰는 기능 설명.
  {
    id: "help", label: "가이드", icon: "📖", path: "/help",
    togglable: true,
  },
  {
    id: "me",        label: "내 정보",  icon: "🪪", path: "/me",
    togglable: true,
  },
  // R26: MFA / 백업 코드 관리. 모든 role 접근 — 보안은 본인 계정 단위.
  {
    id: "security",  label: "보안 설정", icon: "🔐", path: "/me/security",
    togglable: true,
  },
  // R27: 종이장부 ↔ NOX 대조. owner/manager.
  {
    id: "reconcile", label: "종이장부 대조", icon: "📑", path: "/reconcile",
    requiredRoles: ["owner", "manager"],
    togglable: true,
  },
] as const

export const COUNTER_MENU_BY_ID: ReadonlyMap<MenuItemId, MenuItemDefinition> =
  new Map(COUNTER_MENU.map(m => [m.id, m]))

export type SidebarMenuConfig = {
  version: 1
  /** 사용자 정의 순서. 미포함 id 는 manifest 순서 뒤쪽에 자동 붙음. */
  order: MenuItemId[]
  /** 사용자 숨김. togglable=false 항목은 무시된다. */
  hidden: MenuItemId[]
}

export const DEFAULT_SIDEBAR_MENU: SidebarMenuConfig = {
  version: 1,
  order: COUNTER_MENU.map(m => m.id),
  hidden: [],
}

/**
 * Resolve final visible/ordered menu for a given role + optional user
 * config. role filter → user hidden filter → order.
 *
 * 보안 원칙: role 로 제거된 항목은 `config.hidden` 에서 빼는 걸로
 * 되살릴 수 없다. 단계 순서가 그것을 보장한다.
 */
export function resolveMenu(
  role: CounterMenuRole | null,
  config: SidebarMenuConfig = DEFAULT_SIDEBAR_MENU,
): MenuItemDefinition[] {
  // 1. role 필터
  const allowed: MenuItemDefinition[] = COUNTER_MENU.filter(def => {
    if (!def.requiredRoles || def.requiredRoles.length === 0) return true
    if (!role) return false
    return def.requiredRoles.includes(role)
  })
  const allowedIds = new Set(allowed.map(d => d.id))

  // 2. user hidden — togglable=false 는 무시
  const hiddenSet = new Set(config.hidden)

  // 3. order — 사용자 order 우선, 나머지(allowed 중 미포함) 는 manifest 순서로 뒤에
  const seen = new Set<MenuItemId>()
  const result: MenuItemDefinition[] = []
  const pushIfOk = (id: MenuItemId) => {
    if (seen.has(id)) return
    seen.add(id)
    const def = COUNTER_MENU_BY_ID.get(id)
    if (!def) return                         // forward-compat: 미지정 id 무시
    if (!allowedIds.has(def.id)) return      // role 차단
    if (def.togglable && hiddenSet.has(def.id)) return
    result.push(def)
  }
  for (const id of config.order) pushIfOk(id)
  for (const def of COUNTER_MENU) pushIfOk(def.id)
  return result
}
