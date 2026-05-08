/**
 * Hard-coded 한국어 → 빌드 모드별 라벨 매핑 (단순 string 치환).
 *
 * 사용:
 *   - 클라이언트 컴포넌트에서 import { L } from "@/lib/labels/replaceMap"
 *   - 기존 "실장 미지정" → {L("manager")} 미지정
 *
 * 빌드 모드:
 *   - web (default): industry 단어 ("실장", "퍼블릭")
 *   - app: generic 단어 ("매니저", "P 이용권")
 *
 * 이 파일은 simple lookup. 매장별 override 가 필요하면 lib/labels/index.ts
 * 의 getLabel(key, { storeOverrides }) 사용.
 */

import { DEFAULT_LABELS } from "./default"
import { INDUSTRY_LABELS } from "./industry"
import type { LabelKey } from "./default"

const TABLE = process.env.NEXT_PUBLIC_BUILD_MODE === "app"
  ? DEFAULT_LABELS
  : INDUSTRY_LABELS

/**
 * Short alias for inline use in JSX.
 *   <button>{L("manager")} 추가</button>
 *   → web: "실장 추가" / app: "매니저 추가"
 */
export function L(key: LabelKey): string {
  return TABLE[key] ?? key
}

/**
 * DB 에 저장된 service_type 키 (영구 — 절대 변경 X) 를 빌드 모드별 표시 라벨로
 * 변환. service_type 컬럼은 "퍼블릭", "셔츠", "하퍼", "차3" 그대로 유지.
 *   web: "퍼블릭" / app: "P 이용권"
 *   web: "셔츠"   / app: "S 이용권"
 *   web: "하퍼"   / app: "H 이용권"
 *   "차3" → web "차3" / app "추가시간"
 *   "반티" → web "반티" / app "단축"
 */
export function serviceTypeLabel(serviceType: string | null | undefined): string {
  if (!serviceType) return ""
  const isApp = process.env.NEXT_PUBLIC_BUILD_MODE === "app"
  if (!isApp) return serviceType
  switch (serviceType) {
    case "퍼블릭": return "P 이용권"
    case "셔츠": return "S 이용권"
    case "하퍼": return "H 이용권"
    case "차3": return "추가시간"
    case "반티": return "단축"
    case "완티": return "기본"
    default: return serviceType
  }
}
