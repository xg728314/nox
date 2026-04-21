// BLE engine for auto entry/exit detection

import type { BleSignal, BleConfig, EngineDecision, TagState } from "./types";

export type { BleSignal, BleConfig, EngineDecision, TagState };

export function createBleEngine(config: BleConfig) {
  // In-memory state per tag
  const tagStates = new Map<string, TagState>();

  function getOrCreateTagState(tagId: string): TagState {
    if (!tagStates.has(tagId)) {
      tagStates.set(tagId, {
        lastSeenTs: 0,
        currentRoomId: null,
        enterHoldStartTs: null,
        exitHoldStartTs: null,
        lastCheckoutTs: 0
      });
    }
    return tagStates.get(tagId)!;
  }

  function ingest(signal: BleSignal): EngineDecision[] {
    const decisions: EngineDecision[] = [];
    const state = getOrCreateTagState(signal.tagId);

    // Update last seen time
    state.lastSeenTs = signal.ts;

    // Check if we're in cooldown period
    if (state.lastCheckoutTs && (signal.ts - state.lastCheckoutTs) < config.cooldownMs) {
      return decisions; // Still in cooldown, ignore signals
    }

    // Handle enter detection
    if (signal.rssi >= config.enterRssi) {
      // Strong signal detected
      if (state.currentRoomId === signal.roomId) {
        // Same room, continue or start enter hold
        if (!state.enterHoldStartTs) {
          state.enterHoldStartTs = signal.ts;
        }
        
        // Check if hold time is satisfied
        if (signal.ts - state.enterHoldStartTs >= config.enterHoldMs) {
          decisions.push({
            type: "ENTER_CONFIRMED",
            tagId: signal.tagId,
            roomId: signal.roomId,
            ts: signal.ts
          });
          
          // Reset state after enter confirmation
          state.enterHoldStartTs = null;
          state.exitHoldStartTs = null;
        }
      } else {
        // Different room, reset and start new enter hold
        state.currentRoomId = signal.roomId;
        state.enterHoldStartTs = signal.ts;
        state.exitHoldStartTs = null;
      }
    } else if (signal.rssi <= config.exitRssi) {
      // Weak signal detected, start exit hold
      if (state.currentRoomId === signal.roomId) {
        if (!state.exitHoldStartTs) {
          state.exitHoldStartTs = signal.ts;
        }
        
        // Check if exit hold time is satisfied
        if (signal.ts - state.exitHoldStartTs >= config.exitHoldMs) {
          decisions.push({
            type: "EXIT_CONFIRMED",
            tagId: signal.tagId,
            roomId: signal.roomId,
            ts: signal.ts
          });
          
          // Reset state after exit confirmation
          state.currentRoomId = null;
          state.enterHoldStartTs = null;
          state.exitHoldStartTs = null;
          state.lastCheckoutTs = signal.ts;
        }
      }
    }

    return decisions;
  }

  function tick(nowTs: number): EngineDecision[] {
    const decisions: EngineDecision[] = [];

    // Check all tags for timeout-based exits
    for (const [tagId, state] of Array.from(tagStates.entries())) {
      // Skip if we're in cooldown period
      if (state.lastCheckoutTs && (nowTs - state.lastCheckoutTs) < config.cooldownMs) {
        continue;
      }

      // Check for timeout exit (no signals for exitHoldMs)
      if (state.currentRoomId && 
          state.lastSeenTs > 0 && 
          (nowTs - state.lastSeenTs) >= config.exitHoldMs) {
        
        decisions.push({
          type: "EXIT_CONFIRMED",
          tagId: tagId,
          roomId: state.currentRoomId,
          ts: nowTs
        });
        
        // Reset state after exit confirmation
        state.currentRoomId = null;
        state.enterHoldStartTs = null;
        state.exitHoldStartTs = null;
        state.lastCheckoutTs = nowTs;
      }
    }

    return decisions;
  }

  return {
    ingest,
    tick
  };
}
