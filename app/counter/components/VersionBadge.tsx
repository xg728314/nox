/**
 * R-Ver: 카운터 사이드바 상단 버전 배지.
 *
 * 표시:
 *   - 평상시: "v0.1.0 · b478ee8" (소형, 낮은 contrast)
 *   - 새 버전 감지 시: cyan glow + 빨간 점 + "🔄 새 버전" 표시
 *   - 클릭 시 모달 → 전체 정보 + "새로고침" + "복사"
 *
 * 갱신:
 *   - useVersionPolling: 5분 polling + visibilitychange 시 fetch
 *   - 새 revision 감지 시 toast (자동 reload X — 사용자 작업 보호)
 */

"use client"

import { useEffect, useState } from "react"
import { useVersionPolling } from "@/lib/system/useVersionPolling"
import { useToast } from "@/components/Toast"

function formatKst(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
  } catch {
    return "—"
  }
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}시간 ${m}분`
  if (m > 0) return `${m}분`
  return `${seconds}초`
}

export default function VersionBadge() {
  const { current, hasUpdate, refetch } = useVersionPolling()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  // 새 revision 감지 시 토스트 (자동 reload 안 함 — 사용자 작업 보호)
  const [toastShown, setToastShown] = useState(false)
  useEffect(() => {
    if (hasUpdate && !toastShown) {
      toast.show({
        type: "info",
        message: "새 버전이 배포됐습니다. 작업 끝나면 새로고침 권장.",
        duration: 8000,
      })
      setToastShown(true)
    }
  }, [hasUpdate, toastShown, toast])

  if (!current) {
    return (
      <div className="px-5 py-1.5 text-[10px] text-slate-600 border-b border-white/10">
        버전 확인 중…
      </div>
    )
  }

  async function copyAll() {
    if (!current) return
    const text = [
      `NOX 시스템 정보`,
      `버전: ${current.version}`,
      `Git: ${current.git_short_sha}`,
      `Revision: ${current.revision}`,
      `빌드: ${formatKst(current.built_at)}`,
      `가동: ${formatUptime(current.uptime_seconds)}`,
    ].join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`
          w-full px-5 py-1.5 text-[10px] flex items-center justify-between gap-2
          border-b border-white/10 transition-colors
          ${hasUpdate
            ? "text-cyan-300 bg-cyan-500/[0.08] hover:bg-cyan-500/[0.15]"
            : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"}
        `}
        title={hasUpdate ? "새 버전이 있습니다" : "시스템 정보"}
      >
        <span className="truncate font-mono">
          v{current.version} · {current.git_short_sha}
        </span>
        {hasUpdate && (
          <span className="flex-shrink-0 inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span>NEW</span>
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-cyan-300/20 bg-[#0A1222] p-5 space-y-3 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">⚙ NOX 시스템 정보</div>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">×</button>
            </div>

            <dl className="space-y-1.5 text-xs font-mono">
              <Row label="버전" value={current.version} />
              <Row label="Git" value={current.git_short_sha} mono />
              {current.git_message && <Row label="메시지" value={current.git_message} multiline />}
              <Row label="Revision" value={current.revision} mono />
              <Row label="Region" value={current.region} />
              <Row label="빌드" value={formatKst(current.built_at)} />
              <Row label="가동" value={formatUptime(current.uptime_seconds)} />
              <Row label="런타임" value={current.runtime} />
            </dl>

            {hasUpdate && (
              <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-2 text-[11px] text-cyan-100">
                🔄 새 버전이 배포됐습니다. 작업이 끝나면 페이지를 새로고침하세요.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={copyAll}
                className="py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs hover:bg-white/[0.08]"
              >
                {copied ? "✓ 복사됨" : "📋 복사"}
              </button>
              <button
                onClick={() => { refetch(); setOpen(false) }}
                className="py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-500/30"
              >
                🔄 새로고침
              </button>
            </div>

            <p className="text-[10px] text-slate-500 leading-relaxed">
              사고 발생 시 위 정보를 복사해서 신고하면 디버깅이 빠릅니다.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-16 flex-shrink-0 text-slate-500">{label}</dt>
      <dd className={`flex-1 min-w-0 ${mono ? "font-mono" : ""} ${multiline ? "break-words" : "truncate"} text-slate-200`}>
        {value}
      </dd>
    </div>
  )
}
