"use client"

/**
 * BleHint — secondary zone pill rendered beside the manual state badge
 * on participant / worker rows. Subtle by design — manual state remains
 * authoritative.
 *
 * Two sources:
 *   - `source="ble"`       → "BLE · <zone>" (cyan tint, live-pulse dot)
 *   - `source="corrected"` → "수정 · <zone>" (amber tint, static dot)
 *
 * When a human correction is in effect the visual is deliberately
 * distinguishable so the operator never mistakes an overlay for a live
 * BLE reading.
 */

import type { MonitorBleZone } from "../types"

export const BLE_ZONE_LABEL: Record<MonitorBleZone, string> = {
  room: "방",
  counter: "카운터",
  restroom: "화장실",
  elevator: "엘리베이터",
  external_floor: "외부(타층)",
  lounge: "라운지",
  unknown: "감지",
}

type Props = {
  zone: MonitorBleZone
  roomLabel?: string | null
  size?: "xs" | "sm"
  className?: string
  /** Source of the zone value. Defaults to "ble" for backward
   *  compatibility with existing call sites that don't yet pass it. */
  source?: "ble" | "corrected"
}

export default function BleHint({ zone, roomLabel, size = "xs", className = "", source = "ble" }: Props) {
  const sizeCls = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-[9.5px] px-1.5 py-0.5"
  const label = zone === "room" && roomLabel
    ? roomLabel
    : BLE_ZONE_LABEL[zone] ?? "감지"
  const corrected = source === "corrected"
  const baseCls = corrected
    ? "bg-amber-500/15 border-amber-500/45 text-amber-100"
    : "bg-cyan-500/10 border-cyan-400/30 text-cyan-200"
  const dotCls = corrected ? "bg-amber-300" : "bg-cyan-300 animate-pulse"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-semibold ${baseCls} ${sizeCls} ${className}`}
      title={corrected ? `수정된 위치: ${BLE_ZONE_LABEL[zone]}` : `BLE 감지: ${BLE_ZONE_LABEL[zone]}`}
    >
      <span className={`inline-block w-1 h-1 rounded-full ${dotCls}`} />
      {corrected ? "수정" : "BLE"} · {label}
    </span>
  )
}
