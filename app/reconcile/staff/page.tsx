"use client"

/**
 * /reconcile/staff — 스태프 전용 종이장부 대조 페이지.
 *
 * 2026-04-30: /reconcile (방별) 과 분리된 별도 진입점.
 *   실장이 본인 담당 스태프의 일별 근무표 (이름·가게·시간·종목·TC 건수·
 *   지급금액) 사진을 등록 → DB session_participants 와 자동 비교.
 *
 * 권한: owner / manager (RECONCILE_ROLE_DEFAULTS).
 *
 * /reconcile 과 차이:
 *   - sheet_kind 'staff' 로 잠금 (선택지 없음).
 *   - 목록은 staff sheet 만 필터링.
 *   - 진입 배너 = 스태프 장부 등록 안내 + 자주 쓰면 AI 인식률 향상.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import CameraCapture from "../components/CameraCapture"

type ListItem = {
  id: string
  sheet_kind: "rooms" | "staff" | "other"
  business_date: string
  status: string
  uploaded_at: string
  file_name: string | null
  signed_url: string | null
  has_extraction: boolean
  has_diff: boolean
  match_status: string | null
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function ReconcileStaffPage() {
  const router = useRouter()
  const [items, setItems] = useState<ListItem[]>([])
  const [date, setDate] = useState(todayISO())
  const [file, setFile] = useState<File | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function load(targetDate: string) {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/list?date=${encodeURIComponent(targetDate)}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = d.message || ""
        if (msg.includes("paper_ledger_snapshots") || msg.includes("schema cache")) {
          setError("DB 마이그레이션 092 (종이장부) 미적용. database/092_paper_ledger.sql 실행 필요.")
        } else {
          setError(msg || "조회 실패")
        }
        return
      }
      // 'staff' sheet 만 필터링 (방별/기타 는 별도 메뉴 /reconcile).
      const all = Array.isArray(d.items) ? d.items as ListItem[] : []
      setItems(all.filter((it) => it.sheet_kind === "staff"))
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(date) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function upload() {
    if (!file) {
      setError("파일을 선택하세요.")
      return
    }
    setUploading(true)
    setError("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("sheet_kind", "staff")              // 스태프 전용 — 강제
      fd.append("business_date", date)
      const res = await apiFetch("/api/reconcile/upload", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || "업로드 실패")
        return
      }
      setFile(null)
      await load(date)
    } catch {
      setError("네트워크 오류")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📑 스태프 종이장부</span>
        <button
          onClick={() => router.push("/reconcile")}
          className="text-xs text-slate-400"
          title="방별 장부로 이동"
        >방별 장부 →</button>
      </div>

      <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
        {/* 안내 배너 */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-3 text-[12px] text-cyan-100 leading-relaxed">
          <div className="font-semibold mb-1">📋 스태프 일별 근무표 등록</div>
          스태프 별 <b>이름 · 가게 · 시간 · 종목 · TC 건수 · 지급금액</b> 을 사진으로 등록하면
          NOX 의 그날 세션 데이터와 자동 대조됩니다. 누락 / 손글씨 오인 항목을 즉시 잡을 수 있고,
          <span className="text-cyan-300"> 자주 쓸수록 AI 가 매장 손글씨에 적응해 인식률이 올라갑니다.</span>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        {/* 업로드 */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-3">
          <div className="text-sm font-semibold text-cyan-200">새 사진 업로드 (스태프 시트)</div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">날짜</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-sm font-semibold hover:bg-cyan-500/20"
            >📷 카메라로 촬영</button>
            <label className="py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-sm font-semibold hover:bg-white/[0.08] cursor-pointer text-center">
              📁 파일 선택
              <input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/webp"
                capture="environment"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          </div>
          {file && (
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="truncate">{file.name} · {(file.size / 1024).toFixed(0)}KB</span>
              <button onClick={() => setFile(null)} className="text-red-400 hover:text-red-300 ml-2">제거</button>
            </div>
          )}
          <button
            onClick={upload}
            disabled={uploading || !file}
            className="w-full py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-semibold text-sm disabled:opacity-50"
          >
            {uploading ? "업로드 중..." : "업로드"}
          </button>
        </div>

        {/* 리스트 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-200">{date} 스태프 시트 ({items.length}건)</div>
            <button onClick={() => load(date)} className="text-xs text-cyan-400">새로고침</button>
          </div>

          {loading && <div className="text-center text-sm text-slate-500 py-6">불러오는 중...</div>}

          {!loading && items.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
              업로드된 스태프 시트 없음. 위에서 첫 사진을 등록해보세요.
            </div>
          )}

          {items.map(it => (
            <button
              key={it.id}
              onClick={() => router.push(`/reconcile/${it.id}`)}
              className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.06]"
            >
              <div className="flex items-center gap-3">
                {it.signed_url && (
                  <img
                    src={it.signed_url}
                    alt=""
                    className="w-16 h-16 rounded object-cover bg-white/5 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-semibold">스태프 시트</span>
                    <span className="text-slate-500 ml-2">{it.business_date}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{it.file_name}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge label={`상태: ${it.status}`} tone="neutral" />
                    {it.has_extraction && <StatusBadge label="추출됨" tone="info" />}
                    {it.has_diff && (
                      <StatusBadge
                        label={
                          it.match_status === "match" ? "✓ 일치"
                          : it.match_status === "mismatch" ? "⚠ 불일치"
                          : it.match_status === "partial" ? "△ 부분일치"
                          : it.match_status ?? ""
                        }
                        tone={
                          it.match_status === "match" ? "success"
                          : it.match_status === "mismatch" ? "danger"
                          : "warn"
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(f) => {
            setFile(f)
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "danger" | "warn" | "info" | "neutral" }) {
  const cls =
    tone === "success" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" :
    tone === "danger"  ? "bg-red-500/15 border-red-500/30 text-red-300" :
    tone === "warn"    ? "bg-amber-500/15 border-amber-500/30 text-amber-300" :
    tone === "info"    ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-300" :
                         "bg-white/[0.05] border-white/10 text-slate-400"
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
}
