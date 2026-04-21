/**
 * BLE receiver-based ingest: parse payload, resolve presence, emit alerts on LEAVE.
 * Called from /api/ble/ingest when FOXPRO_BLE_INGEST_SECRET header is set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePresence } from "./presenceResolver";
import { resolveLeaveRecipients } from "./alertRecipients";
import type { IngestReceiverPayload, ScanInput, PresenceStateRow } from "./presenceTypes";

export type IngestReceiverResult = {
  ok: boolean;
  received: number;
  processed: number;
  leaves: number;
  error?: string;
};

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof v === "number" && Number.isFinite(v))
    return new Date(v).toISOString();
  return null;
}

function parseReceiverPayload(body: unknown): IngestReceiverPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const store_id = b.store_id != null ? String(b.store_id).trim() : "";
  const receiver_id = b.receiver_id != null ? String(b.receiver_id).trim() : "";
  const scansRaw = b.scans;
  if (!store_id || !receiver_id) return null;
  const scans: ScanInput[] = [];
  if (Array.isArray(scansRaw)) {
    for (const s of scansRaw) {
      if (!s || typeof s !== "object") continue;
      const t = s as Record<string, unknown>;
      const tag_id = t.tag_id != null ? String(t.tag_id).trim() : "";
      if (!tag_id) continue;
      const rssi = typeof t.rssi === "number" ? t.rssi : null;
      const seen_at = toIso(t.seen_at) ?? new Date().toISOString();
      scans.push({ tag_id, rssi, seen_at });
    }
  }
  return { store_id, receiver_id, scans };
}

export async function ingestReceiverPayload(
  supabase: SupabaseClient,
  body: unknown,
  nowIso: string
): Promise<IngestReceiverResult> {
  const payload = parseReceiverPayload(body);
  if (!payload || payload.scans.length === 0) {
    return { ok: false, received: 0, processed: 0, leaves: 0, error: "invalid_receiver_payload" };
  }

  const { store_id, receiver_id, scans } = payload;
  let processed = 0;
  let leaves = 0;

  const { data: receiver } = await supabase
    .from("ble_receivers")
    .select("room_id")
    .eq("receiver_id", receiver_id)
    .eq("store_id", store_id)
    .maybeSingle();

  const room_id: number | null =
    receiver && (receiver as { room_id?: number | null }).room_id != null
      ? Number((receiver as { room_id: number }).room_id)
      : null;

  for (const scan of scans) {
    const seen_at = scan.seen_at;

    const { data: scanRows } = await supabase
      .from("ble_scan_events")
      .insert({
        store_id,
        receiver_id,
        tag_id: scan.tag_id,
        rssi: scan.rssi,
        seen_at,
      })
      .select("id");

    const { data: currentRows } = await supabase
      .from("presence_state")
      .select("id, store_id, tag_id, receiver_id, room_id, state, last_seen_at, last_change_at")
      .eq("store_id", store_id)
      .eq("tag_id", scan.tag_id)
      .maybeSingle();

    const current: PresenceStateRow | null = currentRows
      ? (currentRows as PresenceStateRow)
      : null;

    const result = resolvePresence(
      current,
      {
        store_id,
        tag_id: scan.tag_id,
        receiver_id,
        room_id,
        seen_at,
      },
      nowIso
    );

    await supabase.from("presence_state").upsert(
      {
        store_id,
        tag_id: scan.tag_id,
        receiver_id,
        room_id,
        state: result.state,
        last_seen_at: result.last_seen_at,
        last_change_at: result.last_change_at,
      },
      { onConflict: "store_id,tag_id" }
    );
    processed += 1;

    if (result.transition === "LEAVE") {
      leaves += 1;
      const { data: tagRow } = await supabase
        .from("ble_tags")
        .select("person_id")
        .eq("tag_id", scan.tag_id)
        .eq("store_id", store_id)
        .maybeSingle();
      const hostess_profile_id: string | null =
        tagRow && (tagRow as { person_id?: string | null }).person_id
          ? String((tagRow as { person_id: string }).person_id)
          : null;

      const recipients = await resolveLeaveRecipients(supabase, {
        store_id,
        room_id,
        hostess_profile_id,
      });

      const profileIds = [
        recipients.room_manager_profile_id,
        recipients.hostess_profile_id,
        recipients.girl_manager_profile_id,
      ].filter((id): id is string => id != null && id !== "");

      const payloadAlert = {
        tag_id: scan.tag_id,
        room_id,
        receiver_id,
        store_id,
        hostess_profile_id,
        transition: "LEAVE",
      };

      for (const profileId of profileIds) {
        await supabase.from("alerts").insert({
          store_id,
          type: "HOSTESS_LEAVE",
          target_profile_id: profileId,
          payload: payloadAlert,
          status: "NEW",
        });
      }

      void supabase.from("audit_events").insert({
        store_id,
        action: "HOSTESS_LEAVE_ALERT",
        entity_type: "presence",
        entity_id: scan.tag_id,
        payload: { ...payloadAlert, recipients: profileIds },
      });
    }
  }

  return {
    ok: true,
    received: payload.scans.length,
    processed,
    leaves,
  };
}
