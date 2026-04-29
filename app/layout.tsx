import "./globals.css"
import IssueReportButton from "@/components/IssueReportButton"
import { ToastProvider } from "@/components/Toast"
import { ConfirmProvider } from "@/components/ConfirmModal"
import IdleLogoutGate from "@/components/IdleLogoutGate"
import SentryClientInit from "./SentryClientInit"

export const metadata = {
  title: "NOX Counter OS",
  description: "NOX 카운터 운영 시스템",
  icons: {
    icon: "/favicon.png",
  },
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        {/* Sentry client init — server component 내 직접 import 는 client bundle 에
            포함되지 않으므로 별도 client component 로 감싸 body 첫 자식으로 렌더. */}
        <SentryClientInit />
        {/* 2026-04-25: 전역 Toast / Confirm Provider. window.alert / confirm 대체. */}
        <ToastProvider>
          <ConfirmProvider>
            {/* 2026-04-28: 4시간 무조작 시 자동 로그아웃 (운영 정책).
                /login, /signup, /reset-password, /find-id 에서는 자동 비활성. */}
            <IdleLogoutGate />
            {children}
            {/* 전역 플로팅 버그 신고 버튼. 미로그인 시 내부에서 숨김. */}
            <IssueReportButton />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  )
}