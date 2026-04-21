export const BLE_MONITOR_POLL_MS = 5000
export type MonitorPresenceRow = { id: string; minor: number; room_uuid: string | null; membership_id: string | null; last_event_type: string | null; last_seen_at: string | null }
export type MonitorPresenceRoomProjection = { room_uuid: string; room_name: string; people: MonitorPresenceRow[] }
export type MonitorEventRow = { id: string; event_type: string; beacon_minor: number; observed_at: string }
export type MonitorGatewayRow = { id: string; gateway_id: string; display_name: string | null; is_active: boolean }
export type BleMonitorSessionRow = { id: string; room_uuid: string; status: string }
export type BleMonitorSessionParticipantRow = { id: string; membership_id: string; room_uuid: string }
export type BleMonitorRoomCardView = { room_uuid: string; room_name: string; status: string; people: MonitorPresenceRow[] }
export type BleAlertChipView = { id: string; label: string; severity: string }
export type BleCriticalTargetView = { id: string; label: string; reason: string }
export type BleGatewayHealthView = { gateway_id: string; display_name: string | null; is_active: boolean; last_ping_at: string | null }
export type BleKpiView = { label: string; value: number }
export type BleRecentLogView = { id: string; message: string; timestamp: string }
export function buildBleMonitorDashboard(_data: unknown): { rooms: BleMonitorRoomCardView[]; events: MonitorEventRow[]; gateways: MonitorGatewayRow[] } { return { rooms: [], events: [], gateways: [] } }
export function formatMonitorDateTime(iso: string): string { return new Date(iso).toLocaleString("ko-KR") }
export function formatRelativeTime(iso: string): string { const diff = Date.now() - new Date(iso).getTime(); const mins = Math.floor(diff / 60000); return mins < 1 ? "just now" : `${mins}m ago` }
