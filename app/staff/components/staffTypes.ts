/**
 * ROUND-CLEANUP-002: shared types + style maps for staff page components.
 * Extracted from app/staff/page.tsx. Logic unchanged.
 *
 * 2026-04-24: 등급(grade) UI 완전 제거. Grade / GRADES / GRADE_STYLES 및
 *   StaffAnalytics.grade / grade_updated_at 필드 삭제. 서버 응답에 여전히
 *   해당 필드가 포함되어 있어도 런타임상 무해하다 (TS 가 여분 필드에 대해
 *   관대). API 경로는 건드리지 않음.
 */

export type StaffStatus = "양호" | "출근관리 필요" | "갯수관리 필요" | "집중관리"

export type StaffAnalytics = {
  membership_id: string
  name: string
  manager_membership_id: string | null
  status: StaffStatus
  attendance: {
    days: number
    rate: number
    consecutive_absent: number
  }
  performance: {
    total_sessions: number
    avg_per_day: number
    threshold: number
  }
}

export type Criteria = {
  periodDays: number
  minDays: number
  perfUnit: string
  perfMinCount: number
  perfThreshold: number
}

export const STATUS_STYLES: Record<StaffStatus, { bg: string; text: string; border: string }> = {
  "집중관리": { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/25" },
  "출근관리 필요": { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" },
  "갯수관리 필요": { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/25" },
  "양호": { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/25" },
}
