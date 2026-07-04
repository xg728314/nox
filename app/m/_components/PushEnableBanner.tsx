"use client"
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * Push 알림 활성화 배너.
 *   - 미지원 브라우저 / 이미 subscribed / 이전에 dismissed → 표시 안 함.
 *   - "켜기" 클릭:
 *     1) SW 등록 (아직 안 됐으면)
 *     2) Notification 권한 요청
 *     3) VAPID public key 조회
 *     4) PushManager.subscribe
 *     5) subscription 을 /api/push/subscribe 로 서버 저장
 *   - "나중에" 클릭 → localStorage 에 저장, 이후 안 나타남 (해제하려면 브라우저 스토리지 clear)
 *
 * R-push (2026-06-28).
 */
export function PushEnableBanner() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    if (!supported) return
    if (Notification.permission === "denied") return
    let dismissed = false
    try {
      dismissed = localStorage.getItem("nox.push_banner_dismissed") === "true"
    } catch {}
    if (dismissed) return

    // subscription 이미 있으면 표시 X
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (reg) {
          const sub = await reg.pushManager.getSubscription()
          if (sub) return // 이미 subscribed
        }
      } catch {}
      setVisible(true)
    })()
  }, [])

  async function enable() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // 1. SW 등록 확인
      let reg = await navigator.serviceWorker.getRegistration()
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js")
      }
      await navigator.serviceWorker.ready

      // 2. Notification 권한
      const perm = await Notification.requestPermission()
      if (perm !== "granted") {
        setError(perm === "denied" ? "권한이 거부됨" : "권한 미승인")
        setBusy(false)
        return
      }

      // 3. VAPID public key
      const vr = await apiFetch("/api/push/vapid-public")
      if (!vr.ok) throw new Error("VAPID key 조회 실패")
      const { publicKey } = (await vr.json()) as { publicKey: string }

      // 4. subscribe
      // ArrayBuffer 로 명시 캐스팅 — 타입 시스템의 ArrayBufferLike vs ArrayBuffer 차이 회피
      const keyBytes = urlBase64ToUint8Array(publicKey)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      })

      // 5. 서버 저장
      const raw = sub.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
      const res = await apiFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: raw.endpoint,
          keys: raw.keys,
          user_agent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      setVisible(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    try {
      localStorage.setItem("nox.push_banner_dismissed", "true")
    } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2">
      <span className="text-[18px]">🔔</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-extrabold text-blue-900">알림 켜기</div>
        <div className="text-[9px] font-semibold text-blue-700 mt-0.5 truncate">
          {error ?? "임박 방 · dispatch 도착 · 정산 완료 알림"}
        </div>
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="text-[10px] font-extrabold bg-blue-600 text-white rounded-full px-3 py-1.5 disabled:opacity-40 shrink-0"
      >
        {busy ? "..." : "켜기"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="text-[9px] font-bold text-blue-700 px-1.5 shrink-0"
      >
        나중에
      </button>
    </div>
  )
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
