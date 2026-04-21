import type { SupabaseClient } from "@supabase/supabase-js";

type RoomPresenceSummaryRow = {
  room_uuid: string | null;
  present_count: number | null;
  latest_seen_at: string | null;
};

type ZonePresenceDetailRow = {
  hostess_id: string;
  beacon_minor: number | null;
  room_uuid: string | null;
  confidence: number | null;
  last_seen_at: string;
  meta?: Record<string, unknown> | null;
};

type HostessRow = {
  id: string;
  alias_name?: string | null;
  name?: string | null;
};

type RoomRow = {
  id: string;
  room_no: number | null;
  name?: string | null;
};

export type ZoneDerivedPresenceRow = {
  beacon_minor: number;
  gateway_id: string;
  hostess_uuid: string;
  room_uuid: string | null;
  entered_at: string;
  last_seen_at: string;
  room_no: number | null;
  room_name: string | null;
  name: string | null;
  alias_name: string | null;
  real_name: string | null;
};

export type ZoneDerivedPresenceRoomHostess = {
  hostess_id: string;
  name: string | null;
  beacon_minor: number;
  last_seen_at: string;
};

export type ZoneDerivedPresenceRoomProjection = {
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  gateway_id: string | null;
  present_hostesses: ZoneDerivedPresenceRoomHostess[];
};

export type LoadZoneDerivedRoomPresenceResult =
  | {
      ok: true;
      rows: ZoneDerivedPresenceRow[];
      rooms: ZoneDerivedPresenceRoomProjection[];
    }
  | {
      ok: false;
      fallback: true;
      reason: string;
    }
  | {
      ok: false;
      fallback: false;
      reason: string;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_ROOM_FRESH_MS = 20_000;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function getErrorInfo(error: unknown) {
  return {
    code: String((error as any)?.code ?? ""),
    message: String((error as any)?.message ?? error ?? ""),
    details: String((error as any)?.details ?? ""),
    hint: String((error as any)?.hint ?? ""),
  };
}

function isMissingTableOrSchemaCache(error: unknown, resourceHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  const missingKind =
    info.code === "PGRST205" ||
    info.code === "42P01" ||
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table");
  return missingKind && resourceHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function isMissingColumn(error: unknown, columnHints: string[]): boolean {
  const info = getErrorInfo(error);
  const haystack = `${info.message} ${info.details} ${info.hint}`.toLowerCase();
  return info.code === "42703" && columnHints.some((hint) => haystack.includes(hint.toLowerCase()));
}

function buildFallbackRoomName(roomNo: number | null): string | null {
  return Number.isFinite(Number(roomNo ?? NaN)) && Number(roomNo) > 0 ? `${Math.trunc(Number(roomNo))}번방` : null;
}

function normalizePresenceDisplayName(row: { alias_name?: string | null; name?: string | null }): string | null {
  return normalizeOptionalText(row.alias_name) ?? normalizeOptionalText(row.name) ?? null;
}

function readGatewayIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return normalizeOptionalText((meta as Record<string, unknown>).best_gateway_id);
}

function buildRoomProjections(rows: ZoneDerivedPresenceRow[]): ZoneDerivedPresenceRoomProjection[] {
  const grouped = new Map<string, ZoneDerivedPresenceRow[]>();
  for (const row of rows) {
    const roomUuid = String(row.room_uuid ?? "").trim();
    if (!isUuid(roomUuid)) continue;
    if (!grouped.has(roomUuid)) grouped.set(roomUuid, []);
    grouped.get(roomUuid)!.push(row);
  }

  return Array.from(grouped.entries())
    .map(([roomUuid, roomRows]) => {
      const sorted = [...roomRows].sort((left, right) => Date.parse(right.last_seen_at) - Date.parse(left.last_seen_at));
      const latest = sorted[0] ?? null;
      const presentHostesses = sorted.map((row) => ({
        hostess_id: row.hostess_uuid,
        name: normalizeOptionalText(row.name) ?? normalizeOptionalText(row.alias_name) ?? null,
        beacon_minor: Math.max(0, Math.trunc(Number(row.beacon_minor ?? 0))),
        last_seen_at: row.last_seen_at,
      }));
      return {
        room_uuid: roomUuid,
        room_no: latest?.room_no ?? null,
        room_name: latest?.room_name ?? buildFallbackRoomName(latest?.room_no ?? null),
        gateway_id: latest?.gateway_id ?? null,
        present_hostesses: presentHostesses,
      };
    })
    .sort((left, right) => {
      const leftRoomNo = Number(left.room_no ?? NaN);
      const rightRoomNo = Number(right.room_no ?? NaN);
      const leftHasRoomNo = Number.isFinite(leftRoomNo) && leftRoomNo > 0;
      const rightHasRoomNo = Number.isFinite(rightRoomNo) && rightRoomNo > 0;
      if (leftHasRoomNo && rightHasRoomNo) return leftRoomNo - rightRoomNo;
      if (leftHasRoomNo) return -1;
      if (rightHasRoomNo) return 1;
      return String(left.room_uuid).localeCompare(String(right.room_uuid), "en");
    });
}

export async function loadZoneDerivedRoomPresence(args: {
  supabase: SupabaseClient;
  storeUuid: string;
  limit: number;
  activeOnly: boolean;
  gatewayId?: string;
  roomUuid?: string;
  hostessUuid?: string;
}): Promise<LoadZoneDerivedRoomPresenceResult> {
  const storeUuid = String(args.storeUuid ?? "").trim();
  if (!isUuid(storeUuid)) {
    return { ok: false, fallback: false, reason: "PROFILE_STORE_UUID_REQUIRED" };
  }

  const cutoffIso = new Date(Date.now() - ACTIVE_ROOM_FRESH_MS).toISOString();
  let query = args.supabase
    .from("ble_room_presence_current")
    .select("room_uuid, present_count, latest_seen_at")
    .eq("store_uuid", storeUuid)
    .order("latest_seen_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, Math.trunc(Number(args.limit) || 100))));
  if (args.activeOnly) {
    query = query.gte("latest_seen_at", cutoffIso);
  }
  if (isUuid(args.roomUuid)) {
    query = query.eq("room_uuid", args.roomUuid);
  }

  const roomSummaryResult = await query;
  if (roomSummaryResult.error) {
    const fallback =
      isMissingTableOrSchemaCache(roomSummaryResult.error, [
        "public.ble_room_presence_current",
        "ble_room_presence_current",
        "public.ble_tag_zone_state_current",
        "ble_tag_zone_state_current",
      ]) ||
      isMissingColumn(roomSummaryResult.error, ["present_count", "latest_seen_at"]);
    return {
      ok: false,
      fallback,
      reason: String(roomSummaryResult.error.message ?? roomSummaryResult.error),
    };
  }

  const roomSummaries = Array.isArray(roomSummaryResult.data) ? (roomSummaryResult.data as RoomPresenceSummaryRow[]) : [];
  const roomUuids = Array.from(
    new Set(roomSummaries.map((row) => String(row.room_uuid ?? "").trim()).filter((value) => isUuid(value)))
  );
  if (roomUuids.length <= 0) {
    return { ok: true, rows: [], rooms: [] };
  }

  let detailQuery = args.supabase
    .from("ble_tag_zone_state_current")
    .select("hostess_id, beacon_minor, room_uuid, confidence, last_seen_at, meta")
    .eq("store_uuid", storeUuid)
    .eq("zone_type", "room")
    .in("state", ["enter_pending", "stay"])
    .in("room_uuid", roomUuids)
    .order("last_seen_at", { ascending: false });
  if (args.activeOnly) {
    detailQuery = detailQuery.gte("last_seen_at", cutoffIso);
  }
  if (isUuid(args.hostessUuid)) {
    detailQuery = detailQuery.eq("hostess_id", args.hostessUuid);
  }

  const detailResult = await detailQuery;
  if (detailResult.error) {
    const fallback =
      isMissingTableOrSchemaCache(detailResult.error, [
        "public.ble_tag_zone_state_current",
        "ble_tag_zone_state_current",
      ]) || isMissingColumn(detailResult.error, ["meta", "confidence", "last_seen_at"]);
    return {
      ok: false,
      fallback,
      reason: String(detailResult.error.message ?? detailResult.error),
    };
  }

  const zoneRows = Array.isArray(detailResult.data) ? (detailResult.data as ZonePresenceDetailRow[]) : [];
  const filteredZoneRows = args.gatewayId
    ? zoneRows.filter((row) => readGatewayIdFromMeta(row.meta) === args.gatewayId)
    : zoneRows;
  const hostessIds = Array.from(
    new Set(filteredZoneRows.map((row) => String(row.hostess_id ?? "").trim()).filter((value) => isUuid(value)))
  );

  const hostessNameMap = new Map<string, { alias_name: string | null; name: string | null }>();
  if (hostessIds.length > 0) {
    let hostessRows: HostessRow[] = [];
    let hostessErr: unknown = null;
    const primary = await args.supabase.from("hostesses").select("id, alias_name").in("id", hostessIds);
    hostessRows = Array.isArray(primary.data) ? (primary.data as HostessRow[]) : [];
    hostessErr = primary.error;
    if (hostessErr && isMissingColumn(hostessErr, ["alias_name"])) {
      const fallback = await args.supabase.from("hostesses").select("id, name").in("id", hostessIds);
      hostessRows = Array.isArray(fallback.data) ? (fallback.data as HostessRow[]) : [];
      hostessErr = fallback.error;
    }
    if (hostessErr) {
      return { ok: false, fallback: false, reason: String((hostessErr as any)?.message ?? hostessErr) };
    }
    for (const row of hostessRows) {
      const hostessId = String((row as any)?.id ?? "").trim();
      if (!isUuid(hostessId)) continue;
      hostessNameMap.set(hostessId, {
        alias_name: normalizeOptionalText((row as any)?.alias_name),
        name: normalizeOptionalText((row as any)?.name),
      });
    }
  }

  const roomInfoMap = new Map<string, { room_no: number | null; room_name: string | null }>();
  if (roomUuids.length > 0) {
    let roomRows: RoomRow[] = [];
    let roomErr: unknown = null;
    const primary = await args.supabase.from("rooms").select("id, room_no, name").in("id", roomUuids);
    roomRows = Array.isArray(primary.data) ? (primary.data as RoomRow[]) : [];
    roomErr = primary.error;
    if (roomErr && isMissingColumn(roomErr, ["name"])) {
      const fallback = await args.supabase.from("rooms").select("id, room_no").in("id", roomUuids);
      roomRows = Array.isArray(fallback.data) ? (fallback.data as RoomRow[]) : [];
      roomErr = fallback.error;
    }
    if (roomErr) {
      return { ok: false, fallback: false, reason: String((roomErr as any)?.message ?? roomErr) };
    }
    for (const row of roomRows) {
      const roomUuid = String((row as any)?.id ?? "").trim();
      if (!isUuid(roomUuid)) continue;
      const roomNo = Number((row as any)?.room_no ?? NaN);
      roomInfoMap.set(roomUuid, {
        room_no: Number.isFinite(roomNo) && roomNo > 0 ? Math.trunc(roomNo) : null,
        room_name: normalizeOptionalText((row as any)?.name),
      });
    }
  }

  const rows: ZoneDerivedPresenceRow[] = [];
  for (const row of filteredZoneRows) {
    const hostessUuid = String(row.hostess_id ?? "").trim();
    const roomUuid = String(row.room_uuid ?? "").trim();
    if (!isUuid(hostessUuid) || !isUuid(roomUuid)) continue;
    const hostessName = hostessNameMap.get(hostessUuid) ?? { alias_name: null, name: null };
    const roomInfo = roomInfoMap.get(roomUuid) ?? { room_no: null, room_name: null };
    rows.push({
      beacon_minor: Number.isFinite(Number(row.beacon_minor ?? NaN)) ? Math.trunc(Number(row.beacon_minor)) : 0,
      gateway_id: readGatewayIdFromMeta(row.meta) ?? "",
      hostess_uuid: hostessUuid,
      room_uuid: roomUuid,
      entered_at: row.last_seen_at,
      last_seen_at: row.last_seen_at,
      room_no: roomInfo.room_no,
      room_name: roomInfo.room_name ?? buildFallbackRoomName(roomInfo.room_no),
      name: normalizePresenceDisplayName(hostessName),
      alias_name: normalizeOptionalText(hostessName.alias_name),
      real_name: normalizeOptionalText(hostessName.name),
    });
  }

  const rooms = buildRoomProjections(rows);
  const roomProjectionById = new Map<string, ZoneDerivedPresenceRoomProjection>();
  for (const room of rooms) {
    roomProjectionById.set(room.room_uuid, room);
  }
  for (const summary of roomSummaries) {
    const roomUuid = String(summary.room_uuid ?? "").trim();
    if (!isUuid(roomUuid) || roomProjectionById.has(roomUuid)) continue;
    const roomInfo = roomInfoMap.get(roomUuid) ?? { room_no: null, room_name: null };
    const room = {
      room_uuid: roomUuid,
      room_no: roomInfo.room_no,
      room_name: roomInfo.room_name ?? buildFallbackRoomName(roomInfo.room_no),
      gateway_id: null,
      present_hostesses: [],
    };
    rooms.push(room);
    roomProjectionById.set(roomUuid, room);
  }
  rooms.sort((left, right) => {
    const leftRoomNo = Number(left.room_no ?? NaN);
    const rightRoomNo = Number(right.room_no ?? NaN);
    const leftHasRoomNo = Number.isFinite(leftRoomNo) && leftRoomNo > 0;
    const rightHasRoomNo = Number.isFinite(rightRoomNo) && rightRoomNo > 0;
    if (leftHasRoomNo && rightHasRoomNo) return leftRoomNo - rightRoomNo;
    if (leftHasRoomNo) return -1;
    if (rightHasRoomNo) return 1;
    return String(left.room_uuid).localeCompare(String(right.room_uuid), "en");
  });

  return { ok: true, rows, rooms };
}
