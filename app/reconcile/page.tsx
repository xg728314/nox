"use client"

/**
 * /reconcile — 종이장부 ↔ NOX 대조 메인 페이지.
 *
 * R27: 리스트 + 업로드 폼 (스켈레톤). R28~30 에서 추출/비교 UI 추가.
 *
 * 2026-04-30: 실장 (manager) 도 본인 담당 스태프의 장부 사진을 직접
 *   업로드 가능. role 별 기본 sheet_kind 자동 분기:
 *     - manager → 'staff' (본인 담당 스태프 근무표)
 *     - owner   → 'rooms' (방별 매출 장부)
 *   누락 데이터 보정 + AI 인식률 향상을 위한 것.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import CameraCapture from "./components/CameraCapture"

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

export default function ReconcilePage() {
  const router = useRouter()
  const [items, setItems] = useState<ListItem[]>([])
  const [date, setDate] = useState(todayISO())
  const [sheetKind, setSheetKind] = useState<"rooms" | "staff" | "other">("rooms")
  const [file, setFile] = useState<File | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  /** 사용자 role — 'manager' 일 때 sheet_kind 기본값 'staff' + 안내 표기. */
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const r = d?.role ?? null
        setRole(r)
        if (r === "manager") setSheetKind("staff")
      })
      .catch(() => { /* role 모르면 기본값 유지 */ })
  }, [])

  async function load(targetDate: string) {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reconcile/list?date=${encodeURIComponent(targetDate)}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // R29: paper_ledger_snapshots 테이블 미존재 시 명확한 안내.
        const msg = d.message || ""
        if (msg.includes("paper_ledger_snapshots") || msg.includes("schema cache")) {
          setError(
            "DB 마이그레이션 092 (종이장부) 미적용. " +
            "Supabase SQL Editor 에서 database/092_paper_ledger.sql 실행 필요.",
          )
        } else {
          setError(msg || "조회 실패")
        }
        return
      }
      setItems(Array.isArray(d.items) ? d.items : [])
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  // 2026-05-03: date 가 바뀌면 자동 reload — 운영자가 새로고침 안 눌러도 됨.
  useEffect(() => { load(date) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date])

  // ── Day navigation helpers ────────────────────────────────────────
  function shiftDay(delta: number) {
    const d = new Date(date + "T00:00:00")
    d.setDate(d.getDate() + delta)
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
  }
  function goToday() { setDate(todayISO()) }

  // ── Day summary counts (for header chip row) ─────────────────────
  const summary = (() => {
    const total = items.length
    const matched = items.filter(i => i.match_status === "match").length
    const mismatched = items.filter(i => i.match_status === "mismatch").length
    const partial = items.filter(i => i.match_status === "partial").length
    const noDiff = items.filter(i => !i.has_diff).length
    return { total, matched, mismatched, partial, noDiff }
  })()

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
      fd.append("sheet_kind", sheetKind)
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
        <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📑 종이장부 대조</span>
        <div className="w-16" />
      </div>

      <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        {role === "manager" && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3 text-[12px] text-emerald-200 leading-relaxed">
            <div className="font-semibold mb-1">📑 실장용 장부 등록</div>
            본인이 담당하는 스태프의 종이장부를 사진으로 등록하세요.
            누락 없이 매일 올리면 AI 인식률이 향상되고, 정산 비교도 더 정확해집니다.
            <span className="block mt-1 text-[11px] text-emerald-300/80">
              매장 전체 방별 장부는 사장이 별도로 관리합니다.
            </span>
          </div>
        )}

        {/* 날짜 네비게이션 — 어제/오늘/내일 빠른 이동.
            2026-05-03: 운영자가 어제/그제 장부를 보정하는 흐름이 잦음. */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-sm hover:bg-white/[0.08]"
            aria-label="전날"
          >← 전날</button>
          <div className="flex flex-col items-center gap-0.5">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-1.5 text-sm text-center"
            />
            {date !== todayISO() && (
              <button
                type="button"
                onClick={goToday}
                className="text-[10px] text-cyan-400 hover:text-cyan-300"
              >오늘로</button>
            )}
          </div>
          <button
            type="button"
            onClick={() => shiftDay(+1)}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-sm hover:bg-white/[0.08]"
            aria-label="다음날"
          >다음날 →</button>
        </div>

        {/* 일별 요약 chip (해당 날짜 업로드 건수 + match 분포) */}
        {summary.total > 0 && (
          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10 text-slate-300">
              총 {summary.total}건
            </span>
            {summary.matched > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                ✓ 일치 {summary.matched}
              </span>
            )}
            {summary.partial > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                △ 부분 {summary.partial}
              </span>
            )}
            {summary.mismatched > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300">
                ⚠ 불일치 {summary.mismatched}
              </span>
            )}
            {summary.noDiff > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                대조 대기 {summary.noDiff}
              </span>
            )}
          </div>
        )}

        {/* 업로드 */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-3">
          <div className="text-sm font-semibold text-cyan-200">새 사진 업로드</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">날짜</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">시트 종류</label>
              <select
                value={sheetKind}
                onChange={e => setSheetKind(e.target.value as "rooms" | "staff" | "other")}
                className="w-full rounded-lg border border-white/10 bg-[#0A1222]/80 px-3 py-2 text-sm"
              >
                <option value="rooms">방별 장부</option>
                <option value="staff">스태프 근무</option>
                <option value="other">기타</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* R29: 카메라 즉시 촬영 — getUserMedia (HTTPS 필요) */}
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-sm font-semibold hover:bg-cyan-500/20"
            >📷 카메라로 촬영</button>
            {/* 파일 선택 — capture="environment" 로 모바일에서도 OS 카메라 직행 가능 */}
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
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 flex items-center gap-2 text-[11px] text-slate-300">
              <span className="text-base">📄</span>
              <div className="flex-1 min-w-0">
                <div className="truncate">{file.name}</div>
                <div className="text-slate-500">
                  {(file.size / 1024).toFixed(0)}KB · {file.type || "image"}
                </div>
              </div>
              <button
                onClick={() => setFile(null)}
                disabled={uploading}
                className="text-red-400 hover:text-red-300 disabled:opacity-50"
              >제거</button>
            </div>
          )}
          <button
            onClick={upload}
            disabled={uploading || !file}
            className="w-full py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-semibold text-sm disabled:opacity-50"
          >
            {uploading ? `📤 업로드 중… ${file?.name ?? ""}` : "업로드"}
          </button>
        </div>

        {/* 리스트 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-200">{date} 업로드 ({items.length}건)</div>
            <button
              onClick={() => load(date)}
              className="text-xs text-cyan-400"
            >새로고침</button>
          </div>

          {loading && <div className="text-center text-sm text-slate-500 py-6">불러오는 중...</div>}

          {!loading && items.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
              <div className="text-3xl mb-2">📷</div>
              <div className="text-slate-400">{date} 업로드 없음</div>
              <div className="mt-2 text-[11px] text-slate-500">
                위의 [📷 카메라로 촬영] 또는 [📁 파일 선택] 으로 종이장부 사진을 등록하세요.
              </div>
              {date !== todayISO() && (
                <button
                  type="button"
                  onClick={goToday}
                  className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-200"
                >오늘로 돌아가기</button>
              )}
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
                    <span className="font-semibold">
                      {it.sheet_kind === "rooms" ? "방별" : it.sheet_kind === "staff" ? "스태프" : "기타"}
                    </span>
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

      {/* R29: 카메라 캡처 오버레이 */}
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
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
  )
}
