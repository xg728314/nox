import "./globals.css"

export const metadata = {
  title: "NOX Counter OS",
  description: "NOX 카운터 운영 시스템",
  icons: {
    icon: "/favicon.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}