import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { requireStoreId } from "@/lib/storeScopeInvariant";
import { type BLEEvent, normalizeBleEvent } from "@/lib/ble/events";
import { featureFlags } from "@/lib/config/featureFlags";
import { addToBleHistory } from "@/lib/ble/replay";
import { incBleMetric } from "@/lib/ble/metrics";
import { pushLog } from "@/lib/ble/log";
import { computeEventKey } from "@/lib/ble/dedupe";
import {
  incBleDiagReceived,
  incBleDiagDeduped,
  incBleDiagApplied,
  logBleDiagSummaryAndReset
} from "@/lib/ble/diagnostics";
import { pushRssiSample, updateTagLastSeen } from "@/lib/ble/signalQuality";

const SEEN_KEYS_MAX = 2000;
/** Max events per second before we skip (prevents runaway burst). */
const MAX_EVENTS_PER_SECOND = 100;
const RATE_WINDOW_MS = 1000;
/** FOXPRO #20: batch realtime updates to avoid UI rerender storms (100–300ms). */
const BATCH_FLUSH_MS = 150;

export function useBleRealtimeFeed(args: {
  enabled: boolean;
  storeId: number;
  onEvent: (e: BLEEvent) => void;
  /**
   * Optional UI logger (e.g. /counter pushLog).
   * If not provided, falls back to global BLE logger.
   */
  pushLog?: (msg: string) => void;
}): void {
  const seenEventKeys = useRef<Set<string>>(new Set());
  const onEventRef = useRef(args.onEvent);
  onEventRef.current = args.onEvent;
  const batchQueueRef = useRef<BLEEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const seenKeys = seenEventKeys.current;
    const logFn = args.pushLog ?? pushLog;

    let scopedStoreId: number | null;
    try {
      scopedStoreId = requireStoreId(args.storeId, "useBleRealtimeFeed");
    } catch {
      scopedStoreId = null;
    }
    if (scopedStoreId === null) {
      return;
    }

    if (!args.enabled || featureFlags.disableRealtime) {
      return;
    }

    let stopped = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let rateWindowStart = 0;
    let rateCount = 0;

    const cleanupChannel = () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
        channel = null;
      }
    };

    const scheduleRetry = () => {
      if (stopped) return;
      if (retryTimer) return; // single in-flight retry timer
      retryAttempt += 1;
      const delayMs = Math.min(30_000, 3_000 * retryAttempt);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        start();
      }, delayMs);
    };

    const start = () => {
      if (stopped) return;
      cleanupChannel();

      channel = supabase
        .channel(`ble_events:${scopedStoreId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ble_events",
            filter: `store_id=eq.${scopedStoreId}`,
          },
          (payload: { new?: unknown }) => {
            try {
              const now = Date.now();
              if (now - rateWindowStart >= RATE_WINDOW_MS) {
                rateWindowStart = now;
                rateCount = 0;
              }
              rateCount += 1;
              if (rateCount > MAX_EVENTS_PER_SECOND) {
                logFn("[BLE_FEED_RATE]");
                return;
              }

              const raw = payload?.new;
              const isDebug = Boolean(featureFlags.enableDebugMode);
              incBleDiagReceived(1);

              const e = normalizeBleEvent(raw, { expected_store_id: scopedStoreId, pushLog: logFn });

              if (!e) {
                incBleMetric("eventsInvalid");
                logBleDiagSummaryAndReset(isDebug);
                return;
              }

              const key = computeEventKey(e);
              if (seenKeys.has(key)) {
                incBleDiagDeduped(1);
                logBleDiagSummaryAndReset(isDebug);
                return;
              }
              seenKeys.add(key);
              while (seenKeys.size > SEEN_KEYS_MAX) {
                const first = seenKeys.values().next().value;
                if (first !== undefined) seenKeys.delete(first);
              }

              if (stopped) return;
              updateTagLastSeen(e.tag_id, e.ts);
              if (e.rssi != null && Number.isFinite(e.rssi)) {
                pushRssiSample(e.tag_id, e.rssi, e.ts);
              }
              if (featureFlags.enableDebugMode) {
                addToBleHistory(e);
              }
              incBleDiagApplied(1);
              // FOXPRO #20: queue and flush in batch to avoid UI rerender storms
              batchQueueRef.current.push(e);
              if (flushTimerRef.current == null) {
                flushTimerRef.current = setTimeout(() => {
                  flushTimerRef.current = null;
                  const batch = batchQueueRef.current;
                  batchQueueRef.current = [];
                  const cb = onEventRef.current;
                  for (let i = 0; i < batch.length; i++) cb?.(batch[i]!);
                }, BATCH_FLUSH_MS);
              }
              logBleDiagSummaryAndReset(isDebug);
            } catch {
              logFn("[BLE_FEED_FAIL]");
            }
          }
        )
        .subscribe((status: string) => {
          if (stopped) return;
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            logFn("[BLE_FEED_FAIL]");
            scheduleRetry();
          }
        });
    };

    start();

    return () => {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      batchQueueRef.current = [];
      cleanupChannel();
      seenKeys.clear();
    };
  }, [args.enabled, args.storeId, args.pushLog]);
}

