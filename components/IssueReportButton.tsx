"use client"

/**
 * 플로팅 "A/S" 버튼 + 신고 모달.
 *
 * 2026-04-25: 실운영 중 버그/정산불일치/BLE오류 발견 시 누구나 즉시 제출.
 *   현재 페이지 URL + user_agent 자동 첨부.
 * 2026-04-26: 🐞 → A/S 라벨로 변경 (풍뎅이 모양이 채팅 입력창과 겹친다는 피드백).
 *   + 드래그 이동 가능. 위치는 localStorage 에 저장.
 *
 * UX:
 *   - 짧게 클릭: 신고 모달 오픈
 *   - 꾹 누르고 드래그: 위치 이동 → 손 떼면 위치 저장
 *
 * 인쇄 시 숨김 (print:hidden).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { captureException } from "@/lib/telemetry/captureException"

const POS_KEY = "nox.as_button.pos"
const LONG_PRESS_MS = 220
const BTN_SIZE = 44 // 아이콘 버튼 한 변 (px)

type Pos = { right: number; bottom: number }
const DEFAULT_POS: Pos = { right: 16, bottom: 80 }  // 채팅 입력창 위 정도

const CATEGORIES: { value: string; label: string; hint: string }[] = [
  { value: "settlement_mismatch", label: "정산 불일치", hint: "금액이 예상과 다르거나 안 맞음" },
  { value: "ble_location", label: "BLE 위치 오류", hint: "스태프 위치가 엉뚱한 방에 잡힘" },
  { value: "ui_bug", label: "UI 깨짐", hint: "버튼이 안 눌림, 화면 깨짐 등" },
  { value: "data_incorrect", label: "데이터 잘못됨", hint: "이름/금액/시간 등이 잘못 표시" },
  { value: "feature_request", label: "기능 제안", hint: "이런 기능이 있었으면 좋겠다" },
  { value: "other", label: "기타", hint: "" },
]

const SEVERITIES: { value: string; label: string; color: string }[] = [
  { value: "critical", label: "심각", color: "bg-red-500/20 text-red-200 border-red-500/40" },
  { value: "high", label: "높음", color: "bg-orange-500/20 text-orange-200 border-orange-500/40" },
  { value: "medium", label: "중간", color: "bg-amber-500/20 text-amber-200 border-amber-500/40" },
  { value: "low", label: "낮음", color: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
]

function loadPos(): Pos {
  try {
    if (typeof window === "undefined") return DEFAULT_POS
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return DEFAULT_POS
    const p = JSON.parse(raw) as Partial<Pos>
    if (typeof p.right === "number" && typeof p.bottom === "number") {
      return clampPos(p as Pos)
    }
    return DEFAULT_POS
  } catch { return DEFAULT_POS }
}

function clampPos(p: Pos): Pos {
  const margin = 4
  if (typeof window === "undefined") return p
  const w = window.innerWidth, h = window.innerHeight
  return {
    right: Math.max(margin, Math.min(w - BTN_SIZE - margin, p.right)),
    bottom: Math.max(margin, Math.min(h - BTN_SIZE - margin, p.bottom)),
  }
}

export default function IssueReportButton() {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState("other")
  const [severity, setSeverity] = useState("medium")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  // 드래그 위치 state
  const [pos, setPos] = useState<Pos>(DEFAULT_POS)
  const [dragging, setDragging] = useState(false)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; basePos: Pos } | null>(null)
  const movedRef = useRef(false)  // 드래그 발생했는지 — 클릭과 구분

  useEffect(() => { setPos(loadPos()) }, [])

  // 화면 크기 바뀌면 위치 다시 클램프
  useEffect(() => {
    function onResize() { setPos(p => clampPos(p)) }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const onPointerDown = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    movedRef.current = false
    dragStartRef.current = { x: ev.clientX, y: ev.clientY, basePos: pos }
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
    pressTimerRef.current = setTimeout(() => {
      setDragging(true)
      try { (ev.target as HTMLElement).setPointerCapture(ev.pointerId) } catch { /* noop */ }
      try { (navigator as Navigator & { vibrate?: (ms: number) => void }).vibrate?.(15) } catch { /* noop */ }
    }, LONG_PRESS_MS)
  }, [pos])

  const onPointerMove = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging || !dragStartRef.current) return
    movedRef.current = true
    const dx = ev.clientX - dragStartRef.current.x
    const dy = ev.clientY - dragStartRef.current.y
    // right/bottom 좌표계라 부호 반전.
    setPos(clampPos({
      right: dragStartRef.current.basePos.right - dx,
      bottom: dragStartRef.current.basePos.bottom - dy,
    }))
  }, [dragging])

  const finishDrag = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    if (dragging) {
      // 위치 저장
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* noop */ }
    }
    setDragging(false)
    dragStartRef.current = null
  }, [dragging, pos])

  const onPointerUp = useCallback((ev: React.PointerEvent<HTMLButtonElement>) => {
    finishDrag()
    // 드래그 없이 짧게 누르고 뗀 경우만 클릭으로 처리
    if (!movedRef.current && !dragging) {
      setOpen(true)
    }
    try { (ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId) } catch { /* noop */ }
  }, [dragging, finishDrag])

  const onPointerCancel = useCallback(() => { finishDrag() }, [finishDrag])

  // 2026-04-25: 로그인 상태 확인 — 미로그인 시 버튼 숨김.
  //   /api/auth/me 로 HttpOnly 쿠키 기반 인증 여부 확인.
  //   실패해도 조용히 숨김 (로그인 페이지 등 공개 경로에서 발생).
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await apiFetch("/api/auth/me")
        if (!cancelled) setAuthed(res.ok)
      } catch {
        if (!cancelled) setAuthed(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  function reset() {
    setCategory("other")
    setSeverity("medium")
    setTitle("")
    setDescription("")
    setError("")
    setSuccess(false)
  }

  async function submit() {
    if (busy) return
    setError("")
    if (!title.trim()) {
      setError("제목을 입력하세요.")
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch("/api/issues", {
        method: "POST",
        body: JSON.stringify({
          category,
          severity,
          title: title.trim(),
          description: description.trim() || undefined,
          page_url: typeof window !== "undefined" ? window.location.href : undefined,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string }
        setError(d.message || "제출 실패")
        return
      }
      setSuccess(true)
      setTimeout(() => {
        setOpen(false)
        reset()
      }, 1500)
    } catch (e) {
      captureException(e, { tag: "issue_report_submit" })
      setError("네트워크 오류. 다시 시도해주세요.")
    } finally {
      setBusy(false)
    }
  }

  // 2026-04-25: 미로그인 사용자에게는 버튼 자체를 노출 안 함.
  //   authed === null: 확인 중 → 숨김 (깜빡임 방지)
  //   authed === false: 미로그인 → 숨김
  //   authed === true: 버튼 표시
  if (authed !== true) return null

  return (
    <>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        title="A/S — 버그/이상/문의 신고. 꾹 누른 채로 드래그하면 위치 이동."
        style={{
          right: `${pos.right}px`,
          bottom: `${pos.bottom}px`,
          width: `${BTN_SIZE}px`,
          height: `${BTN_SIZE}px`,
          touchAction: "none",
        }}
        className={`print:hidden fixed z-40 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[11px] font-bold tracking-tight hover:bg-amber-500/30 transition-colors shadow-lg backdrop-blur select-none ${dragging ? "ring-2 ring-amber-300/60 cursor-grabbing scale-105" : "cursor-grab"}`}
      >
        A/S
      </button>

      {open && (
        <div
          className="print:hidden fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center"
          onClick={busy ? undefined : () => { setOpen(false); reset() }}
        >
          <div
            className="bg-[#0b0e1c] border-t md:border border-white/10 rounded-t-2xl md:rounded-2xl w-full md:max-w-lg p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">A/S · 이슈 신고</h3>
              <button
                onClick={() => { setOpen(false); reset() }}
                disabled={busy}
                className="text-slate-500 hover:text-slate-300 disabled:opacity-50"
              >✕</button>
            </div>

            {success ? (
              <div className="p-6 text-center">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-emerald-300 font-semibold">제출 완료</div>
                <div className="text-xs text-slate-500 mt-1">관리자에게 전달됐습니다.</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">종류</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setCategory(c.value)}
                        disabled={busy}
                        className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                          category === c.value
                            ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-100"
                            : "bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06]"
                        }`}
                      >
                        <div className="font-semibold">{c.label}</div>
                        {c.hint && <div className="text-[10px] text-slate-500 mt-0.5">{c.hint}</div>}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">심각도</label>
                  <div className="flex gap-2">
                    {SEVERITIES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setSeverity(s.value)}
                        disabled={busy}
                        className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                          severity === s.value ? s.color : "bg-white/[0.03] border-white/10 text-slate-500"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    제목 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    disabled={busy}
                    maxLength={200}
                    placeholder="예: 1번방 체크아웃 후 금액이 2배로 표시"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    자세한 설명 <span className="text-slate-600">(선택)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    disabled={busy}
                    rows={4}
                    maxLength={5000}
                    placeholder="어떤 상황이었는지, 어떤 작업을 했는지, 무엇이 예상과 다른지..."
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40 resize-none"
                  />
                </div>

                <div className="text-[10px] text-slate-600">
                  현재 페이지 URL 과 브라우저 정보가 자동으로 첨부됩니다.
                </div>

                {error && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs">
                    {error}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => { setOpen(false); reset() }}
                    disabled={busy}
                    className="flex-1 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 text-sm disabled:opacity-50"
                  >취소</button>
                  <button
                    onClick={submit}
                    disabled={busy || !title.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm font-semibold disabled:opacity-40"
                  >{busy ? "제출 중..." : "신고"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
