"use client"
/**
 * NewbieTutorialBot — 채팅방 첫 진입 시 개인 안내 봇 카드.
 *
 * R36 (2026-09-09): 채팅방 열면 POST /api/chat/tutorial-check 로 상태 확인.
 *   첫 진입 (chat_tutorial_seen 없음) → show_tutorial=true → 카드 렌더.
 *   재진입 → false → 카드 안 뜸.
 *
 * 카드는 다른 사람 눈에 안 보임 (client-only · 채팅 message 아님).
 * R36-fix: modal overlay (position:fixed z-80) · 채팅 auto-scroll 우회.
 */
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "show"; storeName: string; examples: string[] }
  | { kind: "dismissed" }

export function NewbieTutorialBot() {
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    ;(async () => {
      try {
        const res = await apiFetch("/api/chat/tutorial-check", { method: "POST" })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setState({ kind: "hidden" }); return }
        if (j.show_tutorial) {
          setState({ kind: "show", storeName: j.store_name ?? "우리 매장", examples: j.examples ?? [] })
        } else {
          setState({ kind: "hidden" })
        }
      } catch {
        setState({ kind: "hidden" })
      }
    })()
  }, [])

  function dismiss() {
    setState({ kind: "dismissed" })
    void apiFetch("/api/chat/tutorial-dismiss", { method: "POST" }).catch(() => { /* silent */ })
  }

  if (state.kind !== "show") return null

  // R37-fix (Agent #5): backdrop 클릭 시 stamp 하지 않음 · 「알겠어요」 눌러야만 stamp.
  //   백드롭 클릭은 임시 dismissed 만 (다음 진입 시 다시 뜸)
  function backdropClose() {
    setState({ kind: "dismissed" })
    // stamp 호출 X · 실수 방지
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={backdropClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border-2 border-[#C49B61] bg-gradient-to-br from-[#FAF5EC] to-white shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="text-[28px] shrink-0">🤖</div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-black text-[#2D2B26] mb-1">
              {state.storeName} 채팅에 오신 것을 환영합니다 👋
            </div>
            <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed mb-3">
              이 채팅방은 <b className="text-[#8C6A3A]">자동 파싱 봇</b>이 있어요.
              메시지 형식만 맞으면 <b>세션·조판·정산 자동 등록</b>됩니다.
            </div>
            <div className="rounded-lg bg-white border border-[#EDE7DA] p-3 mb-2">
              <div className="text-[10px] font-black text-[#8C6A3A] uppercase tracking-wider mb-1.5">
                ✍ 이 형식으로 쓰세요
              </div>
              <div className="text-[11px] font-mono font-extrabold text-[#2D2B26] leading-relaxed">
                [매장] [아가씨] [종목] [완메·반메·끝·연장·스타트]
              </div>
            </div>
            <div className="rounded-lg bg-[#C49B61]/10 border border-[#C49B61]/40 p-3 mb-3">
              <div className="text-[10px] font-black text-[#8C6A3A] uppercase tracking-wider mb-1.5">
                📝 예시 (자동 등록 100%)
              </div>
              <div className="text-[11px] font-mono text-[#2D2B26] space-y-0.5">
                {state.examples.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            </div>
            <div className="text-[10px] font-bold text-[#7A746A] leading-relaxed mb-3">
              💡 형식 틀려도 봇이 정중히 안내합니다. 편하게 쓰세요!
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="w-full rounded-xl bg-[#C49B61] py-2.5 text-[12px] font-extrabold text-white active:bg-[#A87D45]"
            >
              ✓ 알겠어요
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
