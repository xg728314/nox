/**
 * formatRoomLabel — "방 표시 이름" 을 계산하는 단일 함수.
 *
 * P1 구조 고정 (2026-04-18)
 *
 * 이전: `${room.room_no}번방` 포맷이 11개 위치에 중복 하드코딩됨.
 *   - app/api/admin/dashboard/route.ts
 *   - app/api/attendance/route.ts
 *   - app/api/ble/presence/route.ts
 *   - app/api/customers/[customer_id]/route.ts
 *   - app/api/inventory/sales-trace/route.ts
 *   - app/api/reports/settlement-tree/route.ts
 *   - app/api/reports/settlement-tree-operational/route.ts
 *   - app/api/sessions/receipt/route.ts
 *   - app/api/rooms/route.ts (신규 방 기본 이름)
 *   - app/counter/components/cards/RoomCardV2.tsx (2회)
 *
 * 현재: 이 함수 하나로 집중. 방 이름 규칙(기본 "N번방", room_name 우선,
 * 빈/공백 안전 처리)을 바꿀 때 한 곳만 수정.
 *
 * 규칙 (기존 모든 호출 사이트와 동일):
 *   - room_name 이 비어있지 않으면 우선
 *   - 아니면 room_no 있을 때만 "<room_no>번방"
 *   - room_no 마저 없으면 빈 문자열
 *
 * 파싱/무거운 연산 없음 — 순수 함수.
 */

export type RoomLabelInput = {
  room_name?: string | null
  room_no?: string | number | null
}

export function formatRoomLabel(room: RoomLabelInput | null | undefined): string {
  if (!room) return ""
  const name = typeof room.room_name === "string" ? room.room_name.trim() : ""
  if (name.length > 0) return name
  const noRaw = room.room_no
  if (noRaw === null || noRaw === undefined) return ""
  const noStr = String(noRaw).trim()
  if (noStr.length === 0) return ""
  return `${noStr}번방`
}

/** 새 방 생성 시 기본 room_name 으로 사용. `app/api/rooms/route.ts` 전용. */
export function defaultRoomName(roomNo: string | number): string {
  return `${roomNo}번방`
}
