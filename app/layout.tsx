import "./globals.css"
import IssueReportButton from "@/components/IssueReportButton"
import { ToastProvider } from "@/components/Toast"
import { ConfirmProvider } from "@/components/ConfirmModal"
import IdleLogoutGate from "@/components/IdleLogoutGate"
import StoreContextBar from "@/components/StoreContextBar"
import SentryClientInit from "./SentryClientInit"
import RegisterServiceWorker from "@/components/RegisterServiceWorker"

export const metadata = {
  title: "NOX Counter OS",
  description: "NOX 카운터 운영 시스템",
  // 2026-04-30: PWA — Next.js 가 app/manifest.ts 를 /manifest.webmanifest 로 serve.
  //   Android Chrome / iOS Safari "홈 화면에 추가" 지원.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  appleWebApp: {
    capable: true,
    title: "NOX",
    statusBarStyle: "black-translucent",
  },
  // 2026-04-30 R-NoTranslate: Chrome 자동 번역 영구 차단.
  //   증상: Chrome 이 한국어 페이지를 한국어→영어→한국어 왕복 번역해서
  //     "재무"→"뭐", "재고"→"존재", "채팅"→"만나다", "감시 대시보드"→
  //     "디스플레이 대시보드", "이슈 신고함"→"고민함" 등으로 깨짐.
  //   증거: Network 에 translateHtml × 8 + m=el_main + gen204 = Google
  //     Translate 의 element-level 번역 호출.
  //   대응: notranslate meta + <html translate="no">. NOX 는 100% 한국
  //     운영자/직원용 → 전역 번역 차단이 맞음.
  other: {
    google: "notranslate",
  },
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#030814",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // R-NoTranslate (2026-04-30): translate="no" 가 강제 차단 핵심.
    //   meta notranslate 만으로는 Chrome 일부 버전에서 무시됨. html 자체에
    //   translate="no" + class="notranslate" 둘 다 적용해야 안전.
    <html lang="ko" translate="no" className="notranslate">
      <body>
        {/* Sentry client init — server component 내 직접 import 는 client bundle 에
            포함되지 않으므로 별도 client component 로 감싸 body 첫 자식으로 렌더. */}
        <SentryClientInit />
        {/* 2026-04-30: PWA service worker 등록 (production only). minimal SW —
            install/activate 만, fetch handler 없음 (정산 데이터 stale cache 위험). */}
        <RegisterServiceWorker />
        {/* 2026-04-25: 전역 Toast / Confirm Provider. window.alert / confirm 대체. */}
        <ToastProvider>
          <ConfirmProvider>
            {/* 2026-04-28: 4시간 무조작 시 자동 로그아웃 (운영 정책).
                /login, /signup, /reset-password, /find-id 에서는 자동 비활성. */}
            <IdleLogoutGate />
            {/* 2026-04-30 (R-store-name): 모든 보호 페이지 상단에 매장명 +
                역할 표시. super_admin 의 매장/역할 override 중에는 fuchsia
                강조 + "원래로" 버튼. /login 등 인증 전 화면은 자동 숨김. */}
            <StoreContextBar />
            {children}
            {/* 전역 플로팅 버그 신고 버튼. 미로그인 시 내부에서 숨김. */}
            <IssueReportButton />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  )
}