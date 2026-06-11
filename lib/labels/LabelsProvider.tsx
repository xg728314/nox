"use client"

/**
 * NOX 라벨 Context Provider — 매장별 라벨 customization 적용.
 *
 * 동작:
 *   1. layout.tsx 에서 <LabelsProvider> 가 모든 페이지를 감쌈.
 *   2. mount 시 /api/auth/me 호출 → 응답의 display_labels 추출.
 *   3. Context 에 저장 → useLabel(key) 가 매장별 override 우선 적용.
 *   4. 미로그인 / display_labels 빈 객체 / 매장 미설정 → 빌드 모드 default.
 *
 * 캐시:
 *   - /api/auth/me 는 30초 TTL + 10초 max-age + 60초 SWR.
 *   - 라벨 변경 후 사용자가 새로고침하면 즉시 반영.
 *   - 점주 설정 페이지에서 PATCH 후 invalidate 가능.
 *
 * 주의:
 *   - "use client" 필수. Context 는 client 측 hook.
 *   - 서버 컴포넌트는 useLabel 사용 불가 → L() (lib/labels/replaceMap) 사용.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import type { LabelKey } from "./default"
import { DEFAULT_LABELS } from "./default"
import { INDUSTRY_LABELS } from "./industry"

// 2026-06-12 R-login-401-noise: 인증 없는 경로에서는 /api/auth/me 호출 skip.
//   기존: layout.tsx 가 모든 페이지 감싸서 login/signup 진입 시도 me 호출 → 401.
//   사용자 DevTools 빨간 X 거슬림.
//   변경: pathname check 로 public path 면 호출 안 함. 라벨도 어차피 미로그인이라 default.
const PUBLIC_PATHS = ["/login", "/signup", "/find-id", "/reset-password"] as const

const BUILD_MODE_TABLE: Record<LabelKey, string> =
  process.env.NEXT_PUBLIC_BUILD_MODE === "app"
    ? DEFAULT_LABELS
    : INDUSTRY_LABELS

type LabelsContextValue = {
  labels: Partial<Record<LabelKey, string>>
  /** 새 라벨 set — owner settings 페이지에서 PATCH 후 즉시 반영. */
  setLabels: (next: Partial<Record<LabelKey, string>>) => void
}

const LabelsContext = createContext<LabelsContextValue>({
  labels: {},
  setLabels: () => {},
})

export function LabelsProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Partial<Record<LabelKey, string>>>({})
  const pathname = usePathname()
  const isPublic = pathname ? PUBLIC_PATHS.some((p) => pathname.startsWith(p)) : false

  useEffect(() => {
    // 인증 없는 경로는 me 호출 안 함 — 401 노이즈 제거
    if (isPublic) return
    let cancelled = false

    async function loadLabels() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
        })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        const dl = data?.display_labels
        if (dl && typeof dl === "object" && !Array.isArray(dl)) {
          setLabels(dl as Partial<Record<LabelKey, string>>)
        }
      } catch {
        // 실패 시 default (빌드 모드 라벨) — 빈 객체 그대로.
      }
    }

    void loadLabels()
    return () => {
      cancelled = true
    }
  }, [isPublic])

  return (
    <LabelsContext.Provider value={{ labels, setLabels }}>
      {children}
    </LabelsContext.Provider>
  )
}

/**
 * 단일 라벨 조회 (매장 override → 빌드 default).
 *
 * 사용:
 *   const managerLabel = useLabel("manager")
 *   <button>{managerLabel} 추가</button>
 */
export function useLabel(key: LabelKey): string {
  const { labels } = useContext(LabelsContext)
  const override = labels[key]
  if (typeof override === "string" && override.trim().length > 0) {
    return override
  }
  return BUILD_MODE_TABLE[key] ?? key
}

/**
 * 모든 라벨 매핑 + setter (owner 설정 페이지에서 사용).
 */
export function useLabelsContext(): LabelsContextValue {
  return useContext(LabelsContext)
}

/**
 * service_type ("퍼블릭", "셔츠", ...) 표시 라벨 변환.
 * 매장 override 가 service_p/service_s/service_h 키에 있으면 그 값 사용.
 */
export function useServiceTypeLabel(serviceType: string | null | undefined): string {
  const { labels } = useContext(LabelsContext)
  if (!serviceType) return ""
  const isApp = process.env.NEXT_PUBLIC_BUILD_MODE === "app"
  // 매장 override 우선
  switch (serviceType) {
    case "퍼블릭": {
      const v = labels.service_p
      if (v) return v
      return isApp ? "P 이용권" : "퍼블릭"
    }
    case "셔츠": {
      const v = labels.service_s
      if (v) return v
      return isApp ? "S 이용권" : "셔츠"
    }
    case "하퍼": {
      const v = labels.service_h
      if (v) return v
      return isApp ? "H 이용권" : "하퍼"
    }
    case "차3":
      return labels.extra_time ?? (isApp ? "추가시간" : "차3")
    case "반티":
      return labels.half_time ?? (isApp ? "단축" : "반티")
    case "완티":
      return labels.full_time ?? (isApp ? "기본" : "완티")
    default:
      return serviceType
  }
}
