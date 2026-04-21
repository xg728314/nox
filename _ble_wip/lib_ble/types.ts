export type BleEvent = any;

/**
 * Recovery shim: normalizeBleEvent is referenced by BLE ingest route.
 * TODO: implement real normalization/validation.
 */
export function normalizeBleEvent(input: any): BleEvent {
  return input as any;
}

/** Recovery shim: BLE engine types required by lib/ble/engine.ts */
export type BleSignal = {
  tagId: string;
  roomId: string;
  rssi: number;
  ts: number;
};

export type BleConfig = {
  enterRssi: number;
  enterHoldMs: number;
  exitRssi: number;
  exitHoldMs: number;
  cooldownMs: number;
};

export type EngineDecision = {
  type: "ENTER_CONFIRMED" | "EXIT_CONFIRMED";
  tagId: string;
  roomId: string;
  ts: number;
};

export type TagState = {
  lastSeenTs: number;
  currentRoomId: string | null;
  enterHoldStartTs: number | null;
  exitHoldStartTs: number | null;
  lastCheckoutTs: number | null;
};
