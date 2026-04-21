/**
 * Unified status styling for Counter Monitoring V2.
 *
 * Single source of truth for state color / icon / label. Every monitor
 * panel (summary, room list, map markers, right panels, absence panel,
 * movement feed) must consume this table. Changes here cascade
 * consistently — do not inline color classes elsewhere.
 *
 * Color system (dark background, glance-readable):
 *   재실        = emerald (green)
 *   이탈        = amber   (orange/amber)
 *   화장실      = purple
 *   외부 (타층) = sky     (blue)
 *   대기        = slate   (neutral)
 *   타점 근무   = fuchsia (cross-store marker; distinct from state)
 */

export type WorkerState =
  | "present"        // 재실 — active participant in active session
  | "mid_out"        // 이탈 — mid_out status (manual today)
  | "restroom"       // 화장실 — BLE-only signal
  | "external_floor" // 외부 (타층) — BLE-only signal
  | "waiting"        // 대기 — home-store hostess, not working anywhere
  | "away"           // 타점 근무 — home hostess working at another store

export type StatusStyle = {
  label: string
  /** Filled chip (border + bg + text). Use for badges. */
  chip: string
  /** Dot-only bg class for map marker highlight. */
  dot: string
  /** Text-only color class (no bg). */
  text: string
  /** Border-only class (for room cards / outlines). */
  border: string
  /** Large count-cell color for SummaryBar. */
  count: string
  /** Short icon glyph (kept in ASCII/emoji so no extra deps). */
  icon: string
}

export const STATUS_STYLES: Record<WorkerState, StatusStyle> = {
  present: {
    label: "재실",
    chip:   "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
    dot:    "bg-emerald-400",
    text:   "text-emerald-300",
    border: "border-emerald-500/40",
    count:  "text-emerald-300",
    icon:   "●",
  },
  mid_out: {
    label: "이탈",
    chip:   "bg-amber-500/15 border-amber-500/45 text-amber-200",
    dot:    "bg-amber-400",
    text:   "text-amber-300",
    border: "border-amber-500/45",
    count:  "text-amber-300",
    icon:   "↗",
  },
  restroom: {
    label: "화장실",
    chip:   "bg-purple-500/15 border-purple-500/45 text-purple-200",
    dot:    "bg-purple-400",
    text:   "text-purple-300",
    border: "border-purple-500/45",
    count:  "text-purple-300",
    icon:   "🚻",
  },
  external_floor: {
    label: "외부 (타층)",
    chip:   "bg-sky-500/15 border-sky-500/45 text-sky-200",
    dot:    "bg-sky-400",
    text:   "text-sky-300",
    border: "border-sky-500/45",
    count:  "text-sky-300",
    icon:   "⇗",
  },
  waiting: {
    label: "대기",
    chip:   "bg-white/[0.05] border-white/10 text-slate-300",
    dot:    "bg-slate-400",
    text:   "text-slate-300",
    border: "border-white/10",
    count:  "text-slate-300",
    icon:   "◌",
  },
  away: {
    label: "타점 근무",
    chip:   "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-200",
    dot:    "bg-fuchsia-400",
    text:   "text-fuchsia-300",
    border: "border-fuchsia-500/40",
    count:  "text-fuchsia-300",
    icon:   "✈",
  },
}

/**
 * Derive a monitor participant's canonical state from its server-provided
 * status/zone fields. Keep this pure — server remains the policy source.
 */
export function participantState(status: string, zone: string): WorkerState {
  if (status === "mid_out" || zone === "mid_out") return "mid_out"
  if (status === "active" && zone === "room") return "present"
  // unknown / inactive / left → waiting (neutral)
  return "waiting"
}

/** Human-readable elapsed time like "12분 전" / "2시간 전". */
export function elapsedLabel(isoStart: string, now: number = Date.now()): string {
  try {
    const start = new Date(isoStart).getTime()
    if (!Number.isFinite(start)) return ""
    const diff = Math.max(0, now - start)
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return "방금"
    if (mins < 60) return `${mins}분 전`
    const hours = Math.floor(mins / 60)
    const remMin = mins % 60
    if (hours < 24) return remMin > 0 ? `${hours}시간 ${remMin}분 전` : `${hours}시간 전`
    const days = Math.floor(hours / 24)
    return `${days}일 전`
  } catch { return "" }
}
