/**
 * NOX 라벨 시스템 — UI 표시 단어 통합 관리.
 *
 * 목적:
 *   1. 앱스토어 (Apple/Google) 심사 통과를 위한 generic 라벨 default.
 *   2. nox.ai.kr 웹 사용자에게는 익숙한 industry 라벨 유지.
 *   3. 점주가 매장 설정에서 직접 라벨 customization 가능.
 *
 * 적용 우선순위:
 *   1. 매장별 store_settings.display_labels (DB 저장, 점주 설정) — 최우선
 *   2. 빌드 모드 default (NEXT_PUBLIC_BUILD_MODE)
 *      - "app"   → DEFAULT_LABELS (P/S/H 이용권, 매니저, ...)
 *      - "web"   → INDUSTRY_LABELS (퍼블릭/셔츠/하퍼, 실장, ...)
 *      - 미지정 → INDUSTRY_LABELS (기존 nox.ai.kr 동작 유지)
 *
 * 사용:
 *   getLabel("manager")  → "매니저" (app) / "실장" (web)
 *   getLabel("service_p", { storeOverrides }) → 매장 settings 에 있으면 그 값.
 *
 * DB 저장 키 (절대 변경 금지 — 마이그레이션 필요):
 *   - service_type 컬럼 값: "P", "S", "H" (앱 default)
 *   - 기존 데이터: "퍼블릭", "셔츠", "하퍼" → 그대로 유지 (호환).
 *   - 신규 매장: "P", "S", "H" 로 저장 → 라벨 시스템이 표시명 변환.
 */

import { DEFAULT_LABELS, type LabelKey } from "./default"
import { INDUSTRY_LABELS } from "./industry"

export type { LabelKey } from "./default"

/**
 * 빌드 모드. 클라이언트/서버 모두에서 접근.
 * 환경 변수 우선순위:
 *   - NEXT_PUBLIC_BUILD_MODE (빌드 시점 결정)
 *   - 미지정 → "web" (현재 nox.ai.kr 동작)
 */
function getBuildMode(): "app" | "web" {
  if (typeof process !== "undefined") {
    const mode = process.env.NEXT_PUBLIC_BUILD_MODE
    if (mode === "app") return "app"
  }
  return "web"
}

const BUILD_MODE = getBuildMode()

const BASE_LABELS: Record<LabelKey, string> =
  BUILD_MODE === "app" ? DEFAULT_LABELS : INDUSTRY_LABELS

/**
 * 라벨 조회. 매장별 override 가 있으면 우선 적용.
 *
 * @param key 라벨 키 (lib/labels/default.ts 의 LabelKey).
 * @param opts.storeOverrides 매장 설정에서 가져온 라벨 매핑 (있을 시).
 */
export function getLabel(
  key: LabelKey,
  opts?: { storeOverrides?: Partial<Record<LabelKey, string>> | null },
): string {
  const override = opts?.storeOverrides?.[key]
  if (typeof override === "string" && override.trim().length > 0) {
    return override
  }
  return BASE_LABELS[key] ?? key
}

/**
 * 매장 라벨 override 객체 검증 (서버에서 점주 입력값 받을 때).
 * 알려지지 않은 키는 무시. 빈 string 도 무시 (default 사용).
 */
export function sanitizeStoreLabels(
  raw: unknown,
): Partial<Record<LabelKey, string>> {
  if (!raw || typeof raw !== "object") return {}
  const known = Object.keys(DEFAULT_LABELS) as LabelKey[]
  const out: Partial<Record<LabelKey, string>> = {}
  const obj = raw as Record<string, unknown>
  for (const k of known) {
    const v = obj[k]
    if (typeof v === "string" && v.trim().length > 0 && v.length <= 50) {
      out[k] = v.trim()
    }
  }
  return out
}

/**
 * 모든 라벨 키와 default 표시 (점주 설정 화면에서 안내).
 */
export function listLabelKeys(): Array<{ key: LabelKey; defaultValue: string; webValue: string }> {
  const keys = Object.keys(DEFAULT_LABELS) as LabelKey[]
  return keys.map((k) => ({
    key: k,
    defaultValue: DEFAULT_LABELS[k],
    webValue: INDUSTRY_LABELS[k],
  }))
}

/**
 * 디버그/개발 용. 현재 빌드 모드 노출.
 */
export function getCurrentBuildMode(): "app" | "web" {
  return BUILD_MODE
}
