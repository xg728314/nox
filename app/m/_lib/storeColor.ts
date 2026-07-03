/**
 * 매장명 → 안정된 색 팔레트.
 *   같은 매장은 항상 같은 색. 14개 매장 hash → hue distribution 균등.
 *   R-session-group (2026-06-28): 사용자 요청 — 같은 매장/방 시각화.
 */

export type StoreColor = {
  /** 좌측 세로 스트라이프 색 (진한 톤) */
  stripe: string
  /** 헤더 배경 tint (연한 톤) */
  headerBg: string
  /** 헤더 텍스트 색 (진한 톤) */
  headerText: string
  /** 컨테이너 border (미디엄 톤) */
  border: string
}

/** 알려진 주요 매장은 고정 palette (일관성). 그 외는 hash 로 자동. */
const NAMED: Record<string, { hue: number }> = {
  "라이브": { hue: 210 },   // 파랑
  "마블": { hue: 0 },       // 빨강
  "신세계": { hue: 145 },   // 녹색
  "파티": { hue: 280 },     // 보라
  "황진이": { hue: 45 },    // 노랑
  "아우라": { hue: 190 },   // 청록
  "쥬비스": { hue: 320 },   // 핑크
  "옵티": { hue: 25 },      // 오렌지
  "블랑": { hue: 170 },     // 민트
  "노블": { hue: 260 },     // 남보라
}

function hashHue(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function getStoreColor(storeName: string | null | undefined): StoreColor {
  const name = (storeName ?? "").trim()
  const hue = NAMED[name]?.hue ?? hashHue(name || "-")
  return {
    stripe: `hsl(${hue} 65% 50%)`,
    headerBg: `hsl(${hue} 85% 95%)`,
    headerText: `hsl(${hue} 70% 28%)`,
    border: `hsl(${hue} 55% 75%)`,
  }
}
