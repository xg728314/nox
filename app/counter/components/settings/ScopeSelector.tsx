"use client"

/**
 * ScopeSelector — Phase D.
 *
 * "이 매장만" vs "전체 적용" 토글. 내부적으로는 `target: "store" | "global"`
 * 로 매핑되며, 편집기들이 `setLayout(next, target)` / `setConfig(next,
 * target)` 호출 시 그대로 전달한다.
 *
 * 기본값은 "이 매장만" — 사용자가 현재 보고 있는 매장에만 적용되는 게
 * 직관적이기 때문. `storeUuid` 가 null (멤버십 미지정 등) 이면 "이 매장만"
 * 은 비활성화되고 "전체 적용" 만 선택 가능.
 */

export type ScopeTarget = "store" | "global"

type Props = {
  target: ScopeTarget
  onChange: (t: ScopeTarget) => void
  storeDisabled?: boolean
}

export default function ScopeSelector({ target, onChange, storeDisabled = false }: Props) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/10 p-1">
      <button
        type="button"
        onClick={() => { if (!storeDisabled) onChange("store") }}
        disabled={storeDisabled}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          target === "store"
            ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >이 매장만</button>
      <button
        type="button"
        onClick={() => onChange("global")}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
          target === "global"
            ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >전체 적용</button>
    </div>
  )
}
