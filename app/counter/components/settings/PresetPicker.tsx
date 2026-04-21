"use client"

/**
 * PresetPicker — Phase 1 preset UI. Renders a horizontal row of preset
 * buttons. Clicking one calls `onApply(preset.config)` — the editor is
 * responsible for copying that into the draft. Nothing auto-saves.
 */

type Preset<T> = { id: string; label: string; description?: string; config: T }

type Props<T> = {
  presets: readonly Preset<T>[]
  onApply: (config: T) => void
  /** Disable all preset buttons (e.g., admin forced override active). */
  disabled?: boolean
}

export default function PresetPicker<T>({ presets, onApply, disabled = false }: Props<T>) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500 flex-shrink-0">프리셋</span>
      <div className="flex items-center gap-1 flex-wrap">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onApply(p.config)}
            title={p.description ?? p.label}
            className="px-2 py-1 rounded-md text-[11px] font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
          >{p.label}</button>
        ))}
      </div>
    </div>
  )
}
