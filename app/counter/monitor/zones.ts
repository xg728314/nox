/**
 * Zone manifest for Counter Monitoring V2 floor map.
 *
 * Zone/block-based layout (NOT coordinate/GPS). Screenshot-matched
 * topology:
 *
 *   row 0 : [room][room][room][restroom(화장실)]
 *   row 1 : [room][room][elevator(엘리베이터)][room]
 *   row 2 : counter strip — full width, labeled "카운터"
 *
 * The counter strip is intentionally a single labeled cell today because
 * multi-store counter data is out of scope for this round (rule: no
 * cross-store data leakage). A future "cross-store overlay" round can
 * split this into per-store counter slots.
 */

// 2026-04-24: FloorId / 층 배열을 lib/building/floors.ts 단일 원본에서
//   import. 9층 추가 같은 변경 시 한 곳만 수정.
import { BUILDING_FLOORS, type FloorId, floorLabel } from "@/lib/building/floors"

export type { FloorId }
export type ZoneKind = "room" | "counter" | "restroom" | "elevator" | "lounge"

export type ZoneBlock = {
  id: string
  kind: ZoneKind
  row: number
  col: number
  /** Spans multiple columns if > 1. Only used by the counter strip today. */
  colspan?: number
  label?: string
}

export type FloorLayout = {
  floor: FloorId
  cols: number
  rows: number
  fixedZones: ZoneBlock[]
}

const makeFloor = (floor: FloorId): FloorLayout => ({
  floor,
  cols: 4,
  rows: 3,
  fixedZones: [
    { id: `f${floor}-restroom`, kind: "restroom", row: 0, col: 3, label: "화장실" },
    { id: `f${floor}-elevator`, kind: "elevator", row: 1, col: 2, label: "엘리베이터" },
    { id: `f${floor}-counter`,  kind: "counter",  row: 2, col: 0, colspan: 4, label: "카운터" },
  ],
})

// 2026-04-24: BUILDING_FLOORS 에서 동적 생성. 층 추가 시 floors.ts 만 수정.
export const FLOOR_LAYOUTS: Record<FloorId, FloorLayout> = Object.fromEntries(
  BUILDING_FLOORS.map((f) => [f, makeFloor(f)]),
) as Record<FloorId, FloorLayout>

export const FLOOR_TABS: ReadonlyArray<{ id: FloorId | "all"; label: string }> = [
  ...BUILDING_FLOORS.map((f) => ({ id: f, label: floorLabel(f) })),
  { id: "all" as const, label: "전체층" },
]
