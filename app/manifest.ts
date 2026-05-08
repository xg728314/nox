import type { MetadataRoute } from "next"

/**
 * Web App Manifest — PWA "홈 화면 추가" 지원.
 *
 * 운영자 의도 (2026-04-30):
 *   "어플 만들 때 더 완벽해지도록 — 모바일 앱이 최종 목표."
 *
 * 1단계: PWA. 네이티브 앱 빌드 없이 매니저/카운터가 모바일 홈 화면에 추가
 *        → 풀스크린 standalone 으로 동작. 코드는 단일 Next.js.
 * 2단계 (향후): 필요 시 Capacitor / Tauri 로 native shell 감싸기.
 *
 * Next.js 15 가 build time 에 /manifest.webmanifest 로 serve. layout.tsx 의
 *   metadata 가 자동으로 link rel="manifest" 추가.
 *
 * Icon 정책:
 *   - public/favicon.png (1024x1024) 단일 이미지. Android Chrome / iOS 가
 *     필요 사이즈로 자동 다운스케일. 정식 192/512 분리는 디자인 라운드에서.
 *
 * display: "standalone" — 주소창 / 탭 숨겨서 native 앱 같은 경험.
 * orientation: 미지정 — 카운터(가로) / 모바일(세로) 자동 적응.
 */

export default function manifest(): MetadataRoute.Manifest {
  // 2026-05-08: 빌드 모드 분기. 앱스토어 (Apple/Google/원스토어) 심사 시
  //   description 의 "유흥업소" 같은 단어가 reject 사유 → generic B2B 표현.
  const isAppMode = process.env.NEXT_PUBLIC_BUILD_MODE === "app"
  return {
    name: isAppMode ? "NOX 매장 운영 관리" : "NOX Counter OS",
    short_name: "NOX",
    description: isAppMode
      ? "다중 매장 운영 통합 관리 — 매장·직원·고객·정산"
      : "NOX — 매장 운영 관리 시스템",
    start_url: "/",
    display: "standalone",
    background_color: "#030814",
    theme_color: "#030814",
    lang: "ko",
    icons: [
      {
        src: "/favicon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
