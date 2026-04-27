"use client"

/**
 * 카메라 직접 촬영 — 종이장부 대조용.
 *
 * R29 (2026-04-26):
 *   - 모바일/태블릿: navigator.mediaDevices.getUserMedia 로 후면 카메라 (environment)
 *     스트림 받아 video 미리보기 → snapshot 으로 JPEG Blob 생성.
 *   - HTTPS 필수 (브라우저 정책). localhost 도 OK. http://10.x 같은 LAN IP 는 권한 거부.
 *   - 권한 거부 시 file-input 폴백 (capture="environment" 로 OS 카메라).
 *
 * 출력: onCapture(File) 로 JPEG File 객체. 파일명 자동 (yyyy-MM-dd_HHmmss.jpg).
 */

import { useEffect, useRef, useState } from "react"

export type CameraCaptureProps = {
  onCapture: (file: File) => void
  onClose: () => void
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("이 브라우저는 카메라 API 미지원. 파일 선택을 사용해주세요.")
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },  // 후면 카메라 우선
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream

          // TODO(diagnostic): video.play() 와 getUserMedia 의 에러를 분리하기 위해
          //   별도 try/catch. 진단 완료 후 사용자 친화적 메시지로 교체할 것.
          try {
            await videoRef.current.play()
            setReady(true)
          } catch (e) {
            const err = e as DOMException
            console.error("Camera error (video.play):", err)
            // play() 실패 시 stream cleanup 명시 — 카메라 LED/하드웨어 즉시 회수
            streamRef.current?.getTracks().forEach(t => t.stop())
            streamRef.current = null
            if (videoRef.current) videoRef.current.srcObject = null
            setError(`video.play 실패\nname: ${err?.name}\nmessage: ${err?.message}`)
          }
        }
      } catch (e) {
        // TODO(diagnostic): 진단용 raw error 노출. 사용자 폰에서 error.name 확인 후
        //   정확한 케이스별 분기로 교체하고 이 블록 제거할 것.
        //   (NotAllowedError / NotReadableError / OverconstrainedError / AbortError /
        //    SecurityError / NotFoundError / TypeError 등)
        const err = e as DOMException
        const debug = [
          `name: ${err?.name}`,
          `message: ${err?.message}`,
          `ua: ${navigator.userAgent.slice(0, 80)}`,
        ].join("\n")
        console.error("Camera error:", err)

        // HTTPS / localhost 체크는 substring 매칭이 아니라 location 기반이라 유지
        if (location.protocol !== "https:" && location.hostname !== "localhost") {
          setError(`HTTPS 환경에서만 카메라 사용 가능.\n\n${debug}`)
        } else {
          setError(`카메라 오류\n\n${debug}`)
        }
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  async function snap() {
    if (busy) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !ready) return
    setBusy(true)
    try {
      // 비디오 해상도에 맞춰 canvas 사이즈
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        setError("Canvas 2D 컨텍스트 가져오기 실패")
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob: Blob | null = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.92))
      if (!blob) {
        setError("스냅샷 생성 실패")
        return
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      const file = new File([blob], `paper_${ts}.jpg`, { type: "image/jpeg" })
      // 카메라 정지 후 콜백 (parent 가 setFile 후 onClose 호출하면 cleanup 자동)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      onCapture(file)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button onClick={onClose} className="text-cyan-400 text-sm">← 닫기</button>
        <span className="text-white text-sm font-semibold">📷 종이장부 촬영</span>
        <div className="w-12" />
      </div>

      {error && (
        <div className="m-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm whitespace-pre-line break-words">
          {error}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="max-w-full max-h-full object-contain"
        />
        {/* 가이드 프레임 */}
        {ready && (
          <div className="absolute inset-8 border-2 border-cyan-400/50 rounded-lg pointer-events-none">
            <div className="absolute -top-7 left-0 text-[11px] text-cyan-300">종이를 프레임 안에 맞춰주세요</div>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="p-6 flex items-center justify-center gap-4 border-t border-white/10">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-5 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={snap}
          disabled={!ready || busy}
          className="w-20 h-20 rounded-full bg-white border-4 border-cyan-400 disabled:opacity-50 disabled:bg-slate-500 transition-transform active:scale-90"
          aria-label="촬영"
        />
        <div className="w-[60px]" />
      </div>
    </div>
  )
}
