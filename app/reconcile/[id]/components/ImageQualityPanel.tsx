/**
 * R-B: AI 인식 한계 + 다음 촬영 가이드 패널.
 *   - VLM 의 image_quality.warnings[] 를 한국어 hint 로 변환 (qualityHints.ts)
 *   - lighting / focus / handwriting 도 함께 표시
 *   - warnings / hints 가 비어있으면 "양호" 표시
 *
 * 사용자 행동 변화 유도가 목적 — 다음 촬영 시 더 또박또박 / 밝은 곳에서 / 등.
 */

"use client"

import { collectHintsFromWarnings } from "@/lib/reconcile/qualityHints"
import type { ImageQualityHints } from "@/lib/reconcile/types"

export type ImageQualityPanelProps = {
  quality?: ImageQualityHints | null
}

const LIGHTING_LABEL: Record<string, string> = { good: "양호", low: "조도 낮음", dark: "어두움" }
const FOCUS_LABEL: Record<string, string> = { sharp: "선명", blurry: "흐림" }
const HANDWRITING_LABEL: Record<string, string> = { clean: "깨끗함", hard_to_read: "읽기 어려움", mixed: "일부 읽기 어려움" }

function metricTone(value: string | undefined, goodValue: string): string {
  if (!value) return "bg-white/[0.05] text-slate-400 border-white/10"
  if (value === goodValue) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
  return "bg-amber-500/10 text-amber-300 border-amber-500/30"
}

export default function ImageQualityPanel({ quality }: ImageQualityPanelProps) {
  if (!quality) return null

  const warnings = quality.warnings ?? []
  const hints = collectHintsFromWarnings(warnings)

  // 모든 메트릭이 양호 + warnings 0 → "양호" 한 줄로 압축
  const allGood =
    quality.lighting === "good" &&
    quality.focus === "sharp" &&
    quality.handwriting === "clean" &&
    warnings.length === 0

  if (allGood) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
        ✅ 사진 품질 양호 — 인식 신뢰도 높음
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
      <div className="text-xs font-semibold text-amber-200">⚠ AI 인식 한계 + 다음 촬영 가이드</div>

      {/* 메트릭 3개 */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className={`rounded border px-2 py-1 text-[10px] text-center ${metricTone(quality.lighting, "good")}`}>
          <div className="opacity-70">조도</div>
          <div className="font-semibold mt-0.5">{LIGHTING_LABEL[quality.lighting ?? ""] ?? "—"}</div>
        </div>
        <div className={`rounded border px-2 py-1 text-[10px] text-center ${metricTone(quality.focus, "sharp")}`}>
          <div className="opacity-70">초점</div>
          <div className="font-semibold mt-0.5">{FOCUS_LABEL[quality.focus ?? ""] ?? "—"}</div>
        </div>
        <div className={`rounded border px-2 py-1 text-[10px] text-center ${metricTone(quality.handwriting, "clean")}`}>
          <div className="opacity-70">손글씨</div>
          <div className="font-semibold mt-0.5">{HANDWRITING_LABEL[quality.handwriting ?? ""] ?? "—"}</div>
        </div>
      </div>

      {/* AI raw warnings */}
      {warnings.length > 0 && (
        <div>
          <div className="text-[11px] text-amber-100/80 mb-1">감지된 문제:</div>
          <ul className="space-y-0.5 text-[11px] text-amber-100/90 list-disc list-inside">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 사용자 가이드 hints */}
      {hints.length > 0 && (
        <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-2 space-y-1">
          <div className="text-[11px] text-cyan-200 font-semibold">💡 다음 촬영 시 권장</div>
          {hints.map((h, i) => (
            <div key={i} className="text-[11px] text-cyan-100/90 leading-relaxed">
              <span className="mr-1">{h.icon}</span>{h.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
