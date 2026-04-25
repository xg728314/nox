import "./globals.css"
import IssueReportButton from "@/components/IssueReportButton"
import { ToastProvider } from "@/components/Toast"
import { ConfirmProvider } from "@/components/ConfirmModal"

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
        {/* 2026-04-25: 전역 Toast / Confirm Provider. window.alert / confirm 대체. */}
        <ToastProvider>
          <ConfirmProvider>
            {children}
            {/* 전역 플로팅 버그 신고 버튼. 미로그인 시 내부에서 숨김. */}
            <IssueReportButton />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  )
}