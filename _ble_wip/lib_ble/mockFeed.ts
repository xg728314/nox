// Mock BLE signal generator for testing

import type { BleSignal } from "./types";

export function makeEnter(tagId: string, roomId: string, nowTs: number, enterRssi: number = -60, enterHoldMs: number = 20000): BleSignal[] {
  // Return a single signal with timestamp in the past to satisfy hold time immediately
  const past = nowTs - (enterHoldMs + 1000); // Past by hold time + 1 second buffer
  
  return [{
    tagId,
    roomId,
    rssi: enterRssi + 10, // Strong signal above threshold
    ts: past
  }];
}

export function makeExit(tagId: string, roomId: string, nowTs: number, exitRssi: number = -85): BleSignal[] {
  // Return a single signal with weak RSSI to force immediate exit
  return [{
    tagId,
    roomId,
    rssi: exitRssi - 10, // Very weak signal below threshold
    ts: nowTs
  }];
}

export function makeSignalGap(tagId: string, roomId: string, startTs: number, gapMs: number): BleSignal[] {
  const signals: BleSignal[] = [];
  
  // Generate some signals before the gap
  for (let i = 0; i < 3; i++) {
    signals.push({
      tagId,
      roomId,
      rssi: -60 + Math.random() * 10 - 5,
      ts: startTs + (i * 1000)
    });
  }
  
  // No signals during the gap (timeout-based exit)
  
  return signals;
}
