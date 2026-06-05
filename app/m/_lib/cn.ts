/**
 * 클래스 이름 조합 헬퍼 — 가벼운 clsx 대용.
 */
export function cn(...classes: (string | undefined | null | false | 0)[]): string {
  return classes.filter(Boolean).join(" ")
}
