/**
 * 모바일 앱 표시 포맷 헬퍼.
 */

/** 13000000 → "1,300만" */
export function fmtMoney(won: number | null | undefined, opts: { unit?: boolean } = {}): string {
  const n = Number(won)
  if (!Number.isFinite(n) || n === 0) return "—"
  const man = Math.round(n / 10000)
  return opts.unit === false ? String(man) : `${man.toLocaleString()}만`
}

/** 13000000 → "1,300만원" */
export function fmtMoneyWon(won: number | null | undefined): string {
  const n = Number(won)
  if (!Number.isFinite(n) || n === 0) return "—"
  return `${Math.round(n / 10000).toLocaleString()}만원`
}

/** Date → "HH:MM" */
export function fmtHM(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return "—"
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** ISO → 상대 시간 ("방금" / "5분" / "1시간" / "어제") */
export function fmtRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—"
  const d = typeof iso === "string" ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return "—"
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "방금"
  if (diffMin < 60) return `${diffMin}분`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}시간`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return "어제"
  if (diffD < 7) return `${diffD}일`
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
}

/** "M월 D일 요일" */
export function fmtDateKo(d?: Date): string {
  const date = d ?? new Date()
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()]
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekday}요일`
}

/** 이름 첫 글자 (아바타용) */
export function initialOf(name: string | null | undefined): string {
  if (!name) return "?"
  return name.charAt(0)
}
