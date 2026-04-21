/**
 * Phase F: Segment DB persistence layer
 * Non-blocking, graceful-fail persistence for time segments
 * 
 * IMPORTANT: This is background persistence only.
 * UI state remains in local-first hook.
 * DB is source of truth for audit/recovery.
 */

import type { ParticipantTimeSegment } from "./segmentTypes";

const DEBUG_CHECKOUT_SEGMENT_TRACE = false;
const scopedConsole: Console =
  process.env.NODE_ENV === "development" && !DEBUG_CHECKOUT_SEGMENT_TRACE
    ? ({
        ...globalThis.console,
        log: () => {},
        info: () => {},
        debug: () => {},
        warn: () => {},
      } as Console)
    : globalThis.console;
const console: Console = scopedConsole;
const SEGMENT_ROUTE = "/api/counter/participant-segments";

async function callSegmentRoute<T>(
  input: {
    method: "GET" | "POST" | "PATCH";
    query?: Record<string, string | null | undefined>;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const queryString = new URLSearchParams(
    Object.entries(input.query ?? {}).filter(([, value]) => typeof value === "string" && value.trim() !== "") as Array<
      [string, string]
    >
  ).toString();
  const res = await fetch(queryString ? `${SEGMENT_ROUTE}?${queryString}` : SEGMENT_ROUTE, {
    method: input.method,
    credentials: "include",
    cache: "no-store",
    headers: input.method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: input.method === "GET" ? undefined : JSON.stringify(input.body ?? {}),
  });
  const payload = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || payload?.ok !== true || payload.data == null) {
    const err = new Error(
      `[SEGMENT_ROUTE_ERROR] ${input.method} ${SEGMENT_ROUTE} failed: ${
        payload?.error ?? `HTTP_${res.status}`
      }`
    );
    (err as Error & { detail?: unknown }).detail = payload;
    throw err;
  }
  return payload.data;
}

/**
 * Phase F-5: Persist segment creation to DB (ATOMIC)
 * Non-blocking, fire-and-forget with atomic DB-side transaction
 */
export async function persistSegmentCreate(
  segment: ParticipantTimeSegment
): Promise<void> {
  try {
    await callSegmentRoute<{ created?: boolean; duplicate?: boolean }>({
      method: "POST",
      body: {
        segment_id: segment.segment_id,
        participant_id: segment.participant_id,
        session_id: segment.session_id,
        room_uuid: segment.room_uuid,
        entered_at: segment.entered_at,
        exited_at: segment.exited_at,
        source: segment.source,
        confidence_score: segment.confidence_score,
        closed_reason: segment.closed_reason,
        created_at: segment.created_at,
        updated_at: segment.updated_at,
      },
    });

    if (process.env.NODE_ENV === "development") {
      console.info("[SEGMENT_PERSIST_FALLBACK_DEBUG]", {
        path: "api_route_created",
        segment_id: segment.segment_id,
        participant_id: segment.participant_id,
        entered_at: segment.entered_at,
      });
    }
  } catch (error) {
    // Additional top-level error logging
    console.error("[SEGMENT_PERSIST_FALLBACK_ERROR] persistSegmentCreate catch block:", {
      segment_id: segment.segment_id,
      participant_id: segment.participant_id,
      error: error instanceof Error ? error.message : String(error),
      error_object: error,
    });
    throw error; // Re-throw for caller to handle
  }
}

/**
 * Persist segment close to DB
 * Updates exited_at and closed_reason (ONE-TIME ONLY)
 */
export async function persistSegmentClose(
  segment: ParticipantTimeSegment
): Promise<void> {
  try {
    // Safety: Only update if exited_at is set
    if (!segment.exited_at || !segment.closed_reason) {
      console.warn("[Phase F] Skip close persist - missing exited_at or closed_reason");
      return;
    }
    
    // Phase F-3: Get update result to verify row was actually closed
    const result = await callSegmentRoute<{ updatedCount: number }>({
      method: "PATCH",
      body: {
        op: "close_one",
        segment: {
          segment_id: segment.segment_id,
          exited_at: segment.exited_at,
          closed_reason: segment.closed_reason,
          updated_at: segment.updated_at,
        },
      },
    });
    
    // Phase F-3: Only log audit event if row was actually updated
    if (result.updatedCount > 0) {
      if (process.env.NODE_ENV === "development") {
        console.info("[Phase F] Segment closed:", {
          segment_id: segment.segment_id,
          closed_reason: segment.closed_reason,
          exited_at: segment.exited_at,
        });
      }
    } else {
      if (process.env.NODE_ENV === "development") {
        console.info("[Phase F-3] Segment already closed (no audit event):", segment.segment_id);
      }
    }
  } catch (error) {
    console.error("[Phase F] persistSegmentClose error:", error);
    throw error;
  }
}

/**
 * Phase F-2: Persist bulk segment closes to DB
 * Closes all segments for a session (non-blocking)
 * 
 * SAFETY: Also supports room_uuid-based close for checkout orphan recovery
 * 
 * @returns Object with updatedCount for fallback triggering
 */
export async function persistBulkSegmentClose(
  segments: ParticipantTimeSegment[],
  reason: string,
  options?: { room_uuid_fallback?: string }
): Promise<{ updatedCount: number; roomScopeFallback: boolean }> {
  try {
    console.log("[SEGMENT_CLOSE_ENTER]", {
      segments_count: Array.isArray(segments) ? segments.length : -1,
      reason,
      room_uuid_fallback: options?.room_uuid_fallback ?? null,
    });
    
    console.info("[BILLING_TIME_PERSIST_ENTER]", {
      segments_count: segments.length,
      reason,
      room_uuid_fallback: options?.room_uuid_fallback || null,
    });
    
    if (segments.length === 0 && !options?.room_uuid_fallback) {
      console.warn("[BILLING_TIME_PERSIST_EARLY_EXIT]", {
        reason: "no_segments_and_no_room_fallback",
      });
      return { updatedCount: 0, roomScopeFallback: false };
    }
    
    const segmentIds = segments.map(s => s.segment_id);
    const result = await callSegmentRoute<{ updatedCount: number; roomScopeFallback: boolean }>({
      method: "PATCH",
      body: {
        op: "close_bulk",
        segments: segments.map((segment) => ({
          segment_id: segment.segment_id,
          participant_id: segment.participant_id,
          session_id: segment.session_id,
          room_uuid: segment.room_uuid,
        })),
        reason,
        room_uuid_fallback: options?.room_uuid_fallback ?? null,
      },
    });
    const updatedCount = result.updatedCount;
    const isRoomScopeFallback = result.roomScopeFallback;
    
    console.info("[BILLING_TIME_BULK_UPDATE_RESULT]", {
      requested_count: segments.length,
      updated_count: updatedCount,
      reason,
      room_scope_fallback: isRoomScopeFallback,
      segment_ids_requested: segmentIds,
      segment_ids_updated: null,
      session_distribution: [],
    });
    
    console.info("[BILLING_TIME_ROOM_FALLBACK_RESULT]", {
      path: segmentIds.length > 0 ? "session_based" : "room_based",
      updated_count: updatedCount,
      room_scope_fallback: isRoomScopeFallback,
    });
    
    if (updatedCount > 0) {
      if (process.env.NODE_ENV === "development") {
        console.info("[Phase F-3] Bulk segments closed:", {
          requested: segments.length,
          actually_closed: updatedCount,
          reason,
        });
      }
      
      return { updatedCount, roomScopeFallback: isRoomScopeFallback };
    } else {
      // BILLING_TIME_SKIP_NO_DB_ROWS: Log when no rows were updated
      console.warn("[BILLING_TIME_SKIP_NO_DB_ROWS]", {
        requested_segments: segments.length,
        segment_ids_requested: segmentIds,
        reason,
        possible_cause: "segments not in DB, already closed, or session_id mismatch",
      });
      
      // Verify: Check if segments exist in DB with different state
      void (async () => {
        try {
          const dbSegments = await Promise.all(
            segments.slice(0, 10).map(async (segment) => {
              try {
                const rows = await fetchSegmentsForParticipant(segment.participant_id);
                return rows.find((row) => row.segment_id === segment.segment_id) ?? null;
              } catch {
                return null;
              }
            })
          );
          
          // Compare local vs DB state
          const localSegmentMap = new Map(segments.slice(0, 10).map(s => [s.segment_id, s]));
          
          console.warn("[BILLING_TIME_DB_SEGMENT_STATE]", {
            requested_count: segments.length,
            checked_count: Math.min(10, segmentIds.length),
            requested_ids: segmentIds.slice(0, 10),
            db_found_count: dbSegments?.length ?? 0,
            local_vs_db: segmentIds.slice(0, 10).map(segId => {
              const local = localSegmentMap.get(segId);
              const db = dbSegments.find(
                (candidate): candidate is ParticipantTimeSegment =>
                  candidate != null && candidate.segment_id === segId
              );
              return {
                segment_id: segId,
                in_local: !!local,
                in_db: !!db,
                local_session_id: local?.session_id,
                db_session_id: db?.session_id,
                local_exited_at: local?.exited_at,
                db_exited_at: db?.exited_at,
                db_closed_reason: db?.closed_reason,
                mismatch_type: !db ? "NOT_IN_DB" : 
                               db.exited_at !== null ? "ALREADY_CLOSED" :
                               local?.session_id !== db.session_id ? "SESSION_MISMATCH" :
                               "UNKNOWN",
              };
            }),
          });
        } catch (err) {
          console.error("[BILLING_TIME_DB_VERIFY_ERROR]", err);
        }
      })();
      
      if (process.env.NODE_ENV === "development") {
        console.info("[Phase F-3] No segments actually closed (all were already closed)");
      }
      
      return { updatedCount: 0, roomScopeFallback: isRoomScopeFallback };
    }
  } catch (error) {
    console.error("[Phase F-2] persistBulkSegmentClose error:", error);
    return { updatedCount: 0, roomScopeFallback: false };
  }
}

/**
 * Phase F: Fetch segments from DB for recovery/audit
 * Not used in normal flow (local-first is primary)
 */
export async function fetchSegmentsForParticipant(
  participantId: string
): Promise<ParticipantTimeSegment[]> {
  try {
    const result = await callSegmentRoute<{ segments: Array<Record<string, unknown>> }>({
      method: "GET",
      query: { participant_id: participantId },
    });
    const data = Array.isArray(result.segments) ? result.segments : [];
    return data.map((row): ParticipantTimeSegment => ({
      segment_id: String(row.segment_id ?? ""),
      participant_id: String(row.participant_id ?? ""),
      session_id: typeof row.session_id === "string" ? row.session_id : null,
      room_uuid: String(row.room_uuid ?? ""),
      room_no: null, // Phase F-3: Not stored in DB (display-only)
      room_name: null, // Phase F-3: Not stored in DB (display-only)
      entered_at: String(row.entered_at ?? ""),
      exited_at: typeof row.exited_at === "string" ? row.exited_at : null,
      source:
        row.source === "auto" || row.source === "correction" ? row.source : "manual",
      confidence_score:
        Number.isFinite(Number(row.confidence_score ?? NaN)) ? Number(row.confidence_score) : null,
      closed_reason:
        typeof row.closed_reason === "string"
          ? (row.closed_reason as ParticipantTimeSegment["closed_reason"])
          : null,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    }));
  } catch (error) {
    console.error("[Phase F] fetchSegmentsForParticipant error:", error);
    return [];
  }
}
