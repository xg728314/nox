export type RoomStatus = { room_uuid: string; status: string }
export type SessionType = { id: string; room_uuid: string; status: string }
export type ActiveSession = SessionType
export function getRooms(): RoomStatus[] { return [] }
export function getActiveSessions(): SessionType[] { return [] }
export function startSession(_roomUuid: string) { return null }
export function applyBleSignal(_signal: unknown) {}
export function bleTick() {}
