/**
 * Mobile tree root layout — `/m/*`.
 *
 * Independent from the Ops tree. No shared chrome, no shared page
 * components. Only the global app/layout.tsx + this file define the
 * mobile shell.
 */

import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "NOX Mobile Monitor",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07091A",
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#07091A] text-slate-200"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  )
}
