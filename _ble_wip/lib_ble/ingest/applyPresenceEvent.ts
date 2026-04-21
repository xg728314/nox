import type { SupabaseClient } from "@supabase/supabase-js";

export type PresenceEventType = "enter" | "leave" | "heartbeat";

export type ApplyPresenceEventInput = {
  hostess_uuid: string | null;
  beacon_minor: number;
  gateway_id: string;
  room_uuid: string | null;
  store_uuid: string | null;
  observed_at: string;
  event_type: PresenceEventType;
};

export type ApplyPresenceEventResult = {
  presence_updates: number;
  warning: string | null;
};

export async function applyPresenceEvent(
  supabase: SupabaseClient,
  input: ApplyPresenceEventInput
): Promise<ApplyPresenceEventResult> {
  const hostessUuid = String(input.hostess_uuid ?? "").trim();
  if (!hostessUuid) {
    return { presence_updates: 0, warning: "HOSTESS_NOT_MAPPED" };
  }

  const { data: activeRow, error: activeErr } = await supabase
    .from("hostess_presence")
    .select("id, room_uuid, gateway_id, last_seen_at, entered_at")
    .eq("hostess_id", hostessUuid)
    .is("left_at", null)
    .order("entered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeErr) {
    return { presence_updates: 0, warning: `PRESENCE_ACTIVE_QUERY_FAIL:${String(activeErr.message ?? activeErr)}` };
  }

  if (input.event_type === "heartbeat") {
    if (!activeRow) {
      const { error: insertErr } = await supabase.from("hostess_presence").insert({
        hostess_id: hostessUuid,
        beacon_minor: input.beacon_minor,
        gateway_id: input.gateway_id,
        room_uuid: input.room_uuid,
        store_uuid: input.store_uuid,
        entered_at: input.observed_at,
        left_at: null,
        last_seen_at: input.observed_at,
        presence_status: "present",
      });
      if (insertErr) {
        const errCode = String((insertErr as any)?.code ?? "");
        if (errCode === "23505") {
          return {
            presence_updates: 0,
            warning: "HEARTBEAT_INSERT_DUPLICATE_IGNORED:unique_violation",
          };
        }
        return { presence_updates: 0, warning: `HEARTBEAT_INSERT_FAIL:${String(insertErr.message ?? insertErr)}` };
      }
      return { presence_updates: 1, warning: null };
    }
    const activeGatewayId = String((activeRow as any)?.gateway_id ?? "").trim();
    const activeRoomUuid = String((activeRow as any)?.room_uuid ?? "").trim();
    const inputGatewayId = String(input.gateway_id ?? "").trim();
    const inputRoomUuid = String(input.room_uuid ?? "").trim();
    if (activeGatewayId !== inputGatewayId || (inputRoomUuid && activeRoomUuid && activeRoomUuid !== inputRoomUuid)) {
      return {
        presence_updates: 0,
        warning: `HEARTBEAT_MISMATCH:${activeGatewayId || "-"}:${activeRoomUuid || "-"}`,
      };
    }
    const activeLastSeenAt = String((activeRow as any)?.last_seen_at ?? "").trim();
    const activeLastSeenMs = activeLastSeenAt ? Date.parse(activeLastSeenAt) : 0;
    const incomingObservedMs = Date.parse(input.observed_at);
    if (Number.isFinite(activeLastSeenMs) && Number.isFinite(incomingObservedMs) && incomingObservedMs < activeLastSeenMs) {
      return {
        presence_updates: 0,
        warning: `HEARTBEAT_TIME_REVERSAL_IGNORED:active=${activeLastSeenAt},incoming=${input.observed_at}`,
      };
    }
    const { error: touchErr } = await supabase
      .from("hostess_presence")
      .update({
        last_seen_at: input.observed_at,
        presence_status: "present",
        updated_at: new Date().toISOString(),
      })
      .eq("id", String((activeRow as any)?.id ?? ""));
    if (touchErr) return { presence_updates: 0, warning: `HEARTBEAT_TOUCH_FAIL:${String(touchErr.message ?? touchErr)}` };
    return { presence_updates: 1, warning: null };
  }

  if (input.event_type === "enter") {
    if (!activeRow) {
      const { error: insertErr } = await supabase.from("hostess_presence").insert({
        hostess_id: hostessUuid,
        beacon_minor: input.beacon_minor,
        gateway_id: input.gateway_id,
        room_uuid: input.room_uuid,
        store_uuid: input.store_uuid,
        entered_at: input.observed_at,
        left_at: null,
        last_seen_at: input.observed_at,
        presence_status: "present",
      });
      if (insertErr) {
        const errCode = String((insertErr as any)?.code ?? "");
        if (errCode === "23505") {
          return {
            presence_updates: 0,
            warning: `PRESENCE_INSERT_DUPLICATE_IGNORED:unique_violation`,
          };
        }
        return { presence_updates: 0, warning: `PRESENCE_INSERT_FAIL:${String(insertErr.message ?? insertErr)}` };
      }
      return { presence_updates: 1, warning: null };
    }

    const sameRoom = String((activeRow as any)?.room_uuid ?? "").trim() === String(input.room_uuid ?? "").trim();
    const sameGateway = String((activeRow as any)?.gateway_id ?? "").trim() === input.gateway_id;
    if (sameRoom && sameGateway) {
      const activeLastSeenAt = String((activeRow as any)?.last_seen_at ?? "").trim();
      const activeLastSeenMs = activeLastSeenAt ? Date.parse(activeLastSeenAt) : 0;
      const incomingObservedMs = Date.parse(input.observed_at);
      if (Number.isFinite(activeLastSeenMs) && Number.isFinite(incomingObservedMs) && incomingObservedMs < activeLastSeenMs) {
        return {
          presence_updates: 0,
          warning: `ENTER_TIME_REVERSAL_IGNORED:active=${activeLastSeenAt},incoming=${input.observed_at}`,
        };
      }
      const { error: updateErr } = await supabase
        .from("hostess_presence")
        .update({
          last_seen_at: input.observed_at,
          presence_status: "present",
          updated_at: new Date().toISOString(),
        })
        .eq("id", String((activeRow as any)?.id ?? ""));
      if (updateErr) return { presence_updates: 0, warning: `PRESENCE_TOUCH_FAIL:${String(updateErr.message ?? updateErr)}` };
      return { presence_updates: 1, warning: null };
    }

    const activeEnteredAt = String((activeRow as any)?.entered_at ?? "").trim();
    const activeEnteredMs = activeEnteredAt ? Date.parse(activeEnteredAt) : 0;
    const incomingObservedMs = Date.parse(input.observed_at);
    if (Number.isFinite(activeEnteredMs) && Number.isFinite(incomingObservedMs) && incomingObservedMs < activeEnteredMs) {
      return {
        presence_updates: 0,
        warning: `ENTER_ROOM_MOVE_TIME_REVERSAL_IGNORED:active_entered=${activeEnteredAt},incoming=${input.observed_at}`,
      };
    }

    const { error: closeErr } = await supabase
      .from("hostess_presence")
      .update({
        left_at: input.observed_at,
        last_seen_at: input.observed_at,
        presence_status: "left",
        updated_at: new Date().toISOString(),
      })
      .eq("id", String((activeRow as any)?.id ?? ""));
    if (closeErr) return { presence_updates: 0, warning: `PRESENCE_CLOSE_FAIL:${String(closeErr.message ?? closeErr)}` };

    const { error: openErr } = await supabase
      .from("hostess_presence")
      .insert({
        hostess_id: hostessUuid,
        beacon_minor: input.beacon_minor,
        gateway_id: input.gateway_id,
        room_uuid: input.room_uuid,
        store_uuid: input.store_uuid,
        entered_at: input.observed_at,
        left_at: null,
        last_seen_at: input.observed_at,
        presence_status: "present",
      });
    if (openErr) {
      const errCode = String((openErr as any)?.code ?? "");
      if (errCode === "23505") {
        return {
          presence_updates: 1,
          warning: `PRESENCE_REOPEN_DUPLICATE_IGNORED:unique_violation`,
        };
      }
      return { presence_updates: 1, warning: `PRESENCE_REOPEN_FAIL:${String(openErr.message ?? openErr)}` };
    }
    return { presence_updates: 2, warning: null };
  }

  // leave
  if (!activeRow) return { presence_updates: 0, warning: "LEAVE_WITHOUT_ACTIVE_PRESENCE" };
  const activeGatewayId = String((activeRow as any)?.gateway_id ?? "").trim();
  const activeRoomUuid = String((activeRow as any)?.room_uuid ?? "").trim();
  const leaveGatewayMatches = activeGatewayId === String(input.gateway_id ?? "").trim();
  const inputRoomUuid = String(input.room_uuid ?? "").trim();
  const leaveRoomMatches = !inputRoomUuid || !activeRoomUuid || activeRoomUuid === inputRoomUuid;
  if (!leaveGatewayMatches || !leaveRoomMatches) {
    return {
      presence_updates: 0,
      warning: `LEAVE_MISMATCH:${leaveGatewayMatches ? "ROOM" : "GATEWAY"}:${activeGatewayId || "-"}:${activeRoomUuid || "-"}`,
    };
  }
  const activeLastSeenAt = String((activeRow as any)?.last_seen_at ?? "").trim();
  const activeLastSeenMs = activeLastSeenAt ? Date.parse(activeLastSeenAt) : 0;
  const incomingObservedMs = Date.parse(input.observed_at);
  if (Number.isFinite(activeLastSeenMs) && Number.isFinite(incomingObservedMs) && incomingObservedMs < activeLastSeenMs) {
    return {
      presence_updates: 0,
      warning: `LEAVE_TIME_REVERSAL_IGNORED:active=${activeLastSeenAt},incoming=${input.observed_at}`,
    };
  }
  const { error: leaveErr } = await supabase
    .from("hostess_presence")
    .update({
      left_at: input.observed_at,
      last_seen_at: input.observed_at,
      presence_status: "left",
      updated_at: new Date().toISOString(),
    })
    .eq("id", String((activeRow as any)?.id ?? ""));
  if (leaveErr) return { presence_updates: 0, warning: `PRESENCE_LEAVE_FAIL:${String(leaveErr.message ?? leaveErr)}` };
  return { presence_updates: 1, warning: null };
}

