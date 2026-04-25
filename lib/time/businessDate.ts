/**
 * 업무 날짜 (business_date) 계산 헬퍼.
 *
 * R28-fix (2026-04-26): hidden audit agent 발견 — 코드 곳곳에서
 *   `new Date().toISOString().split("T")[0]` 로 UTC 날짜를 추출 중.
 *   KST 00:00~08:59 (= UTC 15:00~23:59 전일) 시간대에 호출되면 어제 날짜로
 *   들어가 영업일이 틀어지는 버그.
 *
 * NOX 운영 시간대는 KST(Asia/Seoul, UTC+9) 고정. 업무일은 0~5시까지 전날에
 *   속함 (영업이 자정 넘어 진행). 본 헬퍼는:
 *
 *   - getBusinessDateKST() — "지금" 의 KST 캘린더 날짜 (yyyy-mm-dd).
 *     영업이 0~5 시 운영 정의는 application 비즈룰이라 별도 함수.
 *
 *   - getBusinessDateForOps(now?) — 0~5 시면 전날, 그 외엔 당일 KST.
 *     business_day_id 매칭에 권장 (CLAUDE.md: "session starting at 23:00
 *     on 4/10 and ending at 01:00 on 4/11 has business_date = 2026-04-10").
 */

const KST_OFFSET_MIN = 9 * 60   // UTC+9
const ROLLOVER_HOUR = 6          // 0~5 KST = 전 영업일

/** "지금" 의 KST 캘린더 날짜 yyyy-mm-dd. 영업일 보정 X. */
export function getBusinessDateKST(now: Date = new Date()): string {
  return ymd(toKstDate(now))
}

/**
 * 영업일 기준 날짜. 0~5 시면 전날 (NOX 영업이 자정 넘어가는 점 보정).
 *
 * 단순 캘린더 날짜가 필요하면 getBusinessDateKST() 사용.
 * 영업/세션/정산 매칭이면 이걸 사용.
 */
export function getBusinessDateForOps(now: Date = new Date()): string {
  const kst = toKstDate(now)
  if (kst.getUTCHours() < ROLLOVER_HOUR) {
    kst.setUTCDate(kst.getUTCDate() - 1)
  }
  return ymd(kst)
}

/** Date 를 KST 시각의 Date 객체로 변환 (UTC fields 가 KST 값을 담음). */
function toKstDate(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MIN * 60 * 1000)
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
