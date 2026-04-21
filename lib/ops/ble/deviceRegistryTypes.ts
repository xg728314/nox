export type BleDeviceRegistryRow = { id: string; minor: number; membership_id: string | null; tag_label: string | null; is_active: boolean }
export type BleDevicesResponse = { devices: BleDeviceRegistryRow[] }
export type BleUnknownDeviceRow = { minor: number; last_seen_at: string }
export type BleUnknownDevicesResponse = { devices: BleUnknownDeviceRow[] }
export type BleAssignablePerson = { membership_id: string; name: string; role: string }
