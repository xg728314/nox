"use client"
/**
 * /nfc/[tag_uuid] — NFC 태그 터치 랜딩 페이지 (PWA · Android)
 *
 * Flow:
 *   1. 폰이 태그 인식 → URL 오픈
 *   2. 로그인 안 됨 → /login?next=/nfc/... 으로 redirect
 *   3. POST /api/nfc/scan → 이벤트 생성 · 30초 카운트다운
 *   4. 실장이 별도 폰에서 [확인] or [오차] 처리
 *   5. 1분 후 auto-confirm cron
 */
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type ScanResponse = {
  event?: { id: string; status: string; scanned_at: string; session_id: string | null; participant_id: string | null }
  tag?: { tag_type: string; label: string; room_uuid: string | null; store_uuid: string }
  debounced?: boolean
  error?: string
  message?: string
}

export default function NfcTagLandingPage() {
  const params = useParams<{ tag_uuid: string }>()
  const router = useRouter()
  const tagUuid = params?.tag_uuid ?? ""

  const [state, setState] = useState<"loading" | "ok" | "auth" | "error">("loading")
  const [msg, setMsg] = useState<string>("")
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [countdown, setCountdown] = useState<number>(60)

  useEffect(() => {
    if (!tagUuid) {
      setState("error"); setMsg("태그 UUID 가 없습니다.")
      return
    }
    let alive = true
    ;(async () => {
      try {
        const res = await apiFetch("/api/nfc/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_uuid: tagUuid }),
        })
        const j: ScanResponse = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.status === 401) {
          setState("auth")
          setMsg("로그인이 필요합니다. 로그인 후 태그를 다시 터치해주세요.")
          return
        }
        if (!res.ok) {
          setState("error")
          setMsg(j.message ?? j.error ?? `HTTP ${res.status}`)
          return
        }
        setResult(j)
        setState("ok")
      } catch (e) {
        if (alive) {
          setState("error")
          setMsg((e as Error).message)
        }
      }
    })()
    return () => { alive = false }
  }, [tagUuid])

  // 카운트다운 (1분)
  useEffect(() => {
    if (state !== "ok") return
    const id = setInterval(() => setCountdown((v) => Math.max(0, v - 1)), 1000)
    return () => clearInterval(id)
  }, [state])

  const tag = result?.tag
  const ev = result?.event
  const labelPrefix =
    tag?.tag_type === "room" ? "🚪 방 도착"
    : tag?.tag_type === "waiter_call" ? "🔔 웨이터 호출"
    : tag?.tag_type === "purchase" ? "🛒 사입 요청"
    : tag?.tag_type === "toilet" ? "🚻 화장실 이동"
    : tag?.tag_type === "manager_call" ? "📢 실장 호출"
    : "📌 NFC"

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-[#FBF6EC] to-[#F8F4ED] flex flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        {state === "loading" && (
          <div className="text-center">
            <div className="text-[16px] font-extrabold text-[#7A746A] animate-pulse">📡 태그 인식 중…</div>
          </div>
        )}

        {state === "auth" && (
          <div className="bg-white rounded-2xl border-2 border-[#DE3A7B] p-6 text-center">
            <div className="text-[18px] font-black text-[#DE3A7B] mb-2">🔒 로그인 필요</div>
            <div className="text-[12px] font-bold text-[#7A746A] mb-4">{msg}</div>
            <button
              type="button"
              onClick={() => router.push(`/login?next=${encodeURIComponent(`/nfc/${tagUuid}`)}`)}
              className="w-full rounded-xl bg-[#2D2B26] text-white text-[13px] font-extrabold py-3"
            >
              로그인 하러 가기
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="bg-white rounded-2xl border-2 border-red-400 p-6 text-center">
            <div className="text-[18px] font-black text-red-600 mb-2">⚠ 태그 오류</div>
            <div className="text-[12px] font-bold text-[#7A746A]">{msg}</div>
          </div>
        )}

        {state === "ok" && tag && ev && (
          <div className="bg-white rounded-2xl border-2 border-[#5FAB4E] p-6 text-center shadow-lg">
            <div className="text-[26px] font-black text-[#2D2B26] mb-1">
              {labelPrefix}
            </div>
            <div className="text-[16px] font-extrabold text-[#8C6A3A] mb-4">
              {tag.label}
            </div>

            <div className="bg-[#5FAB4E]/12 border border-[#5FAB4E]/30 rounded-xl px-4 py-3 mb-3">
              <div className="text-[11px] font-bold text-[#3E7A32] mb-1">✅ 접수 완료</div>
              <div className="text-[13px] font-extrabold text-[#2D2B26]">
                {ev.session_id ? "세션 자동 연결" : "세션 미연결 (실장 확인 필요)"}
              </div>
              {result?.debounced && (
                <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                  (최근 15초 이내 재터치 · 기존 접수 유지)
                </div>
              )}
            </div>

            <div className="text-[10px] font-bold text-[#7A746A]">
              실장이 확인하지 않으면 <b>{countdown}초</b> 후 자동 확정
              <br />
              단체 채팅방에 자동으로 게시됩니다
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 text-[10px] font-semibold text-[#B0A99B]">
        NOX NFC · Phase 3
      </div>
    </div>
  )
}
