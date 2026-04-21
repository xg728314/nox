import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import { loadZoneDerivedRoomPresence } from "@/lib/ble/inference/loadZoneDerivedRoomPresence";
import { shouldEmitDebugOncePerSignature } from "@/lib/counter/debug/repeatSuppression";

export const dynamic = "force-dynamic";

function isUuid(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

function parseLimit(value: string | null): number {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

function parseBool(value: string | null): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "y";
}

function logBlePresenceTrace(step: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  if (!shouldEmitDebugOncePerSignature("BLE_PRESENCE_TRACE", step, payload)) return;
  console.log("[BLE_PRESENCE_TRACE]", payload);
}

function logBlePresenceRouteDebug(key: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  if (!shouldEmitDebugOncePerSignature("BLE_PRESENCE_ROUTE_DEBUG", key, payload)) return;
  console.log("[BLE_PRESENCE_ROUTE_DEBUG]", payload);
}

function logBlePresenceRouteTrace(key: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  if (!shouldEmitDebugOncePerSignature("BLE_PRESENCE_ROUTE_TRACE", key, payload)) return;
  console.log("[BLE_PRESENCE_ROUTE_TRACE]", payload);
}

type PresenceRoomProjection = {
  room_uuid: string;
  room_no: number | null;
  room_name: string | null;
  gateway_id: string | null;
  present_hostesses: Array<{
    hostess_id: string;
    name: string | null;
    beacon_minor: number;
    last_seen_at: string;
  }>;
};

type PresenceWarning = {
  type: "exit_suspected" | "exit_candidate";
  person_name: string;
  device_uid: string;
  last_seen_at: string;
  grace_seconds: number;
};

type PresenceRoomResponse = PresenceRoomProjection & {
  count: number;
  people: string[];
  warnings: PresenceWarning[];
  latest_seen_at: string | null;
};

type TagPresenceRow = {
  hostess_id: string | null;
  minor: number | null;
  gateway_id: string | null;
  room_uuid: string | null;
  rssi: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type TagPresenceApiRow = {
  hostess_uuid: string;
  beacon_minor: number;
  gateway_id: string;
  room_uuid: string | null;
  room_no: number | null;
  room_name?: string | null;
  assigned_person_id?: string | null;
  assigned_person_name?: string | null;
  alias_name: string | null;
  real_name: string | null;
  rssi?: number | null;
  entered_at: string;
  last_seen_at: string;
};

const UNKNOWN_HOSTESS_UUID = "00000000-0000-4000-8000-000000000000";

type RecentPresenceCandidateRow = {
  hostess_id: string | null;
  beacon_minor: number | null;
  room_uuid: string | null;
  last_seen_at: string | null;
};

type RoomInfoRow = {
  id: string;
  room_no?: number | null;
  name?: string | null;
};

const EXIT_WARNING_LOOKBACK_SECONDS = 90;
const EXIT_WARNING_GRACE_SECONDS = 30;
const BLE_TAG_PRESENCE_ACTIVE_SECONDS = 15;
const MAX_ROOMCARD_PEOPLE = 3;

function logBleExitCandidate(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  if (!shouldEmitDebugOncePerSignature("BLE_EXIT_CANDIDATE", "row", payload)) return;
  console.log("[BLE_EXIT_CANDIDATE]", payload);
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

function toDeviceUid(value: unknown): string | null {
  const minor = Math.trunc(Number(value ?? NaN));
  if (!Number.isFinite(minor) || minor <= 0) return null;
  return String(minor);
}

function toIsoOrNull(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function pickLatestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = -1;
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = text;
    }
  }
  return latest;
}

async function loadHostessNameMap(args: {
  supabase: any;
  hostessIds: string[];
}) {
  const hostessIds = Array.from(new Set((Array.isArray(args.hostessIds) ? args.hostessIds : []).filter((value) => isUuid(value))));
  const out = new Map<string, { alias_name: string | null; real_name: string | null }>();
  if (hostessIds.length <= 0) return out;

  let hostessRows: any[] = [];
  let hostessErr: unknown = null;
  const primary = await args.supabase.from("hostesses").select("id, alias_name, name").in("id", hostessIds);
  hostessRows = Array.isArray(primary.data) ? primary.data : [];
  hostessErr = primary.error;
  if (hostessErr && isMissingColumn(hostessErr, ["alias_name"])) {
    const fallback = await args.supabase.from("hostesses").select("id, name").in("id", hostessIds);
    hostessRows = Array.isArray(fallback.data) ? fallback.data : [];
    hostessErr = fallback.error;
  }
  if (hostessErr) return out;

  for (const row of hostessRows) {
    const hostessId = String((row as any)?.id ?? "").trim();
    if (!isUuid(hostessId)) continue;
    out.set(hostessId, {
      alias_name: normalizeOptionalText((row as any)?.alias_name),
      real_name: normalizeOptionalText((row as any)?.name),
    });
  }
  return out;
}

async function loadBleTagPresenceRooms(args: {
  supabase: any;
  storeUuid: string;
  activeOnly: boolean;
  limit: number;
  gatewayId?: string;
  roomUuid?: string;
  hostessUuid?: string;
}): Promise<
  | { ok: true; rows: TagPresenceApiRow[]; rooms: PresenceRoomResponse[] }
  | { ok: false; reason: string; fallback: boolean }
> {
  const cutoffIso = new Date(Date.now() - BLE_TAG_PRESENCE_ACTIVE_SECONDS * 1000).toISOString();
  let query = args.supabase
    .from("ble_tag_presence")
    .select("hostess_id, minor, gateway_id, room_uuid, rssi, first_seen_at, last_seen_at")
    .eq("store_uuid", args.storeUuid)
    .not("room_uuid", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, args.limit)));
  if (args.activeOnly) {
    query = query.gte("last_seen_at", cutoffIso);
  }
  if (args.gatewayId) {
    query = query.eq("gateway_id", args.gatewayId);
  }
  if (isUuid(args.roomUuid)) {
    query = query.eq("room_uuid", args.roomUuid);
  }
  if (isUuid(args.hostessUuid)) {
    query = query.eq("hostess_id", args.hostessUuid);
  }

  const result = await query;
  if (
    result.error &&
    !(
      isMissingTableOrSchemaCache(result.error, ["public.ble_tag_presence", "ble_tag_presence"]) ||
      isMissingColumn(result.error, ["hostess_id", "minor", "room_uuid", "last_seen_at", "first_seen_at"])
    )
  ) {
    return {
      ok: false,
      reason: String((result.error as any)?.message ?? result.error),
      fallback: false,
    };
  }
  if (result.error) {
    return {
      ok: false,
      reason: String((result.error as any)?.message ?? result.error),
      fallback: true,
    };
  }

  const tagRows = Array.isArray(result.data) ? (result.data as TagPresenceRow[]) : [];
  const deviceUids = Array.from(
    new Set(tagRows.map((row) => toDeviceUid(row.minor)).filter((value): value is string => Boolean(value)))
  );
  const roomUuids = Array.from(
    new Set(tagRows.map((row) => String(row.room_uuid ?? "").trim()).filter((value) => isUuid(value)))
  );
  const hostessIds = Array.from(
    new Set(tagRows.map((row) => String(row.hostess_id ?? "").trim()).filter((value) => isUuid(value)))
  );
  const [assignedByDeviceUid, roomInfoMap, hostessNameMap] = await Promise.all([
    loadAssignedDeviceDirectory({ supabase: args.supabase, storeUuid: args.storeUuid, deviceUids }),
    loadRoomInfoMap({ supabase: args.supabase, roomUuids }),
    loadHostessNameMap({ supabase: args.supabase, hostessIds }),
  ]);

  const rows: TagPresenceApiRow[] = [];
  const rowsByRoomUuid = new Map<string, Array<TagPresenceApiRow & { person_name: string | null }>>();
  for (const row of tagRows) {
    const roomUuid = String(row.room_uuid ?? "").trim();
    const lastSeenAt = toIsoOrNull(row.last_seen_at);
    const minor = Number(row.minor ?? NaN);
    if (!isUuid(roomUuid) || !lastSeenAt || !Number.isFinite(minor)) continue;
    const deviceUid = toDeviceUid(minor);
    const hostessId = String(row.hostess_id ?? "").trim();
    const hostessMeta = isUuid(hostessId) ? hostessNameMap.get(hostessId) ?? null : null;
    const assignedMeta = deviceUid ? assignedByDeviceUid.get(deviceUid) ?? null : null;
    const aliasName = hostessMeta?.alias_name ?? null;
    const realName = hostessMeta?.real_name ?? null;
    const assignedPersonName = assignedMeta?.person_name ?? null;
    const roomInfo = roomInfoMap.get(roomUuid);
    const apiRow: TagPresenceApiRow = {
      hostess_uuid: isUuid(hostessId) ? hostessId : UNKNOWN_HOSTESS_UUID,
      beacon_minor: Math.trunc(minor),
      gateway_id: String(row.gateway_id ?? "").trim(),
      room_uuid: roomUuid,
      room_no: roomInfo?.room_no ?? null,
      room_name: roomInfo?.room_name ?? buildFallbackRoomName(roomInfo?.room_no ?? null),
      assigned_person_id: assignedMeta?.person_id ?? null,
      assigned_person_name: assignedPersonName,
      alias_name: aliasName,
      real_name: realName,
      rssi: Number.isFinite(Number(row.rssi ?? NaN)) ? Math.trunc(Number(row.rssi)) : null,
      entered_at: toIsoOrNull(row.first_seen_at) ?? lastSeenAt,
      last_seen_at: lastSeenAt,
    };
    rows.push(apiRow);
    if (!rowsByRoomUuid.has(roomUuid)) rowsByRoomUuid.set(roomUuid, []);
    rowsByRoomUuid.get(roomUuid)!.push({
      ...apiRow,
      person_name: assignedPersonName ?? aliasName ?? realName ?? null,
    });
  }

  const rooms: PresenceRoomResponse[] = Array.from(rowsByRoomUuid.entries())
    .map(([roomUuid, roomRows]) => {
      const sortedRows = [...roomRows].sort((a, b) => {
        const aMs = Date.parse(String(a.last_seen_at ?? ""));
        const bMs = Date.parse(String(b.last_seen_at ?? ""));
        return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
      });
      const roomInfo = roomInfoMap.get(roomUuid);
      const seenNames = new Set<string>();
      const people = sortedRows
        .map((row) => String(row.person_name ?? "").trim())
        .filter((name) => {
          if (!name || seenNames.has(name)) return false;
          seenNames.add(name);
          return true;
        })
        .slice(0, MAX_ROOMCARD_PEOPLE);
      return {
        room_uuid: roomUuid,
        room_no: roomInfo?.room_no ?? null,
        room_name: roomInfo?.room_name ?? buildFallbackRoomName(roomInfo?.room_no ?? null),
        gateway_id: sortedRows[0]?.gateway_id ?? null,
        present_hostesses: sortedRows
          .filter((row) => isUuid(row.hostess_uuid))
          .map((row) => ({
            hostess_id: row.hostess_uuid,
            name: row.assigned_person_name ?? row.person_name ?? row.alias_name ?? row.real_name ?? null,
            beacon_minor: row.beacon_minor,
            last_seen_at: row.last_seen_at,
          })),
        count: sortedRows.length,
        people,
        warnings: [],
        latest_seen_at: pickLatestIso(sortedRows.map((row) => row.last_seen_at)),
      };
    })
    .sort(comparePresenceRoom);

  logBlePresenceRouteDebug(
    `ble_tag_presence:${args.storeUuid}:${args.gatewayId || "all"}:${args.roomUuid || "all"}:${args.hostessUuid || "all"}:${args.activeOnly}:${args.limit}`,
    {
      source: "ble_tag_presence",
      rowsCount: rows.length,
      roomsCount: rooms.length,
      firstRoom: rooms[0] ?? null,
    }
  );

  return { ok: true, rows, rooms };
}

function comparePresenceRoom(left: { room_no: number | null; room_uuid: string }, right: { room_no: number | null; room_uuid: string }) {
  const leftRoomNo = Number(left.room_no ?? NaN);
  const rightRoomNo = Number(right.room_no ?? NaN);
  const leftHasRoomNo = Number.isFinite(leftRoomNo) && leftRoomNo > 0;
  const rightHasRoomNo = Number.isFinite(rightRoomNo) && rightRoomNo > 0;
  if (leftHasRoomNo && rightHasRoomNo) return leftRoomNo - rightRoomNo;
  if (leftHasRoomNo) return -1;
  if (rightHasRoomNo) return 1;
  return String(left.room_uuid).localeCompare(String(right.room_uuid), "en");
}

async function loadRoomInfoMap(args: {
  supabase: any;
  roomUuids: string[];
}) {
  const roomUuids = Array.from(new Set((Array.isArray(args.roomUuids) ? args.roomUuids : []).filter((value) => isUuid(value))));
  const out = new Map<string, { room_no: number | null; room_name: string | null }>();
  if (roomUuids.length <= 0) return out;

  let roomRows: RoomInfoRow[] = [];
  let roomErr: unknown = null;
  const primary = await args.supabase.from("rooms").select("id, room_no, name").in("id", roomUuids);
  roomRows = Array.isArray(primary.data) ? (primary.data as RoomInfoRow[]) : [];
  roomErr = primary.error;
  if (roomErr && isMissingColumn(roomErr, ["name"])) {
    const fallback = await args.supabase.from("rooms").select("id, room_no").in("id", roomUuids);
    roomRows = Array.isArray(fallback.data) ? (fallback.data as RoomInfoRow[]) : [];
    roomErr = fallback.error;
  }
  if (roomErr) return out;

  for (const row of roomRows) {
    const roomUuid = String((row as any)?.id ?? "").trim();
    if (!isUuid(roomUuid)) continue;
    const roomNo = Number((row as any)?.room_no ?? NaN);
    const normalizedRoomNo = Number.isFinite(roomNo) && roomNo > 0 ? Math.trunc(roomNo) : null;
    out.set(roomUuid, {
      room_no: normalizedRoomNo,
      room_name: normalizeOptionalText((row as any)?.name) ?? buildFallbackRoomName(normalizedRoomNo),
    });
  }
  return out;
}

async function loadAssignedDeviceDirectory(args: {
  supabase: any;
  storeUuid: string;
  deviceUids: string[];
}) {
  const out = new Map<string, { device_id: string; person_id: string; person_name: string }>();
  const deviceUids = Array.from(new Set((Array.isArray(args.deviceUids) ? args.deviceUids : []).filter((value) => String(value).trim() !== "")));
  if (deviceUids.length <= 0) return out;

  const devicesResult = await args.supabase
    .from("ble_devices")
    .select("id, device_uid")
    .eq("store_uuid", args.storeUuid)
    .in("device_uid", deviceUids);
  if (
    devicesResult.error &&
    !isMissingTableOrSchemaCache(devicesResult.error, ["public.ble_devices", "ble_devices"])
  ) {
    return out;
  }

  const deviceRows = !devicesResult.error && Array.isArray(devicesResult.data) ? devicesResult.data : [];
  const deviceIdByUid = new Map<string, string>();
  for (const row of deviceRows) {
    const deviceId = String((row as any)?.id ?? "").trim();
    const deviceUid = String((row as any)?.device_uid ?? "").trim();
    if (!isUuid(deviceId) || !deviceUid || deviceIdByUid.has(deviceUid)) continue;
    deviceIdByUid.set(deviceUid, deviceId);
  }

  const deviceIds = Array.from(new Set(deviceIdByUid.values()));
  if (deviceIds.length <= 0) return out;

  const assignmentsResult = await args.supabase
    .from("ble_device_assignments")
    .select("device_id, person_id, assigned_at, is_primary")
    .in("device_id", deviceIds)
    .is("released_at", null)
    .eq("is_primary", true)
    .order("is_primary", { ascending: false })
    .order("assigned_at", { ascending: false });
  if (
    assignmentsResult.error &&
    !isMissingTableOrSchemaCache(assignmentsResult.error, ["public.ble_device_assignments", "ble_device_assignments"])
  ) {
    return out;
  }

  const activeAssignments = !assignmentsResult.error && Array.isArray(assignmentsResult.data) ? assignmentsResult.data : [];
  const personIdByDeviceId = new Map<string, string>();
  for (const row of activeAssignments) {
    const deviceId = String((row as any)?.device_id ?? "").trim();
    const personId = String((row as any)?.person_id ?? "").trim();
    if (!isUuid(deviceId) || !isUuid(personId) || personIdByDeviceId.has(deviceId)) continue;
    personIdByDeviceId.set(deviceId, personId);
  }

  const personIds = Array.from(new Set(personIdByDeviceId.values()));
  const personNameById = new Map<string, string>();
  if (personIds.length > 0) {
    let hostessRows: any[] = [];
    let hostessErr: unknown = null;
    const hostessPrimary = await args.supabase.from("hostesses").select("id, alias_name").in("id", personIds);
    hostessRows = Array.isArray(hostessPrimary.data) ? hostessPrimary.data : [];
    hostessErr = hostessPrimary.error;
    if (hostessErr && isMissingColumn(hostessErr, ["alias_name"])) {
      const hostessFallback = await args.supabase.from("hostesses").select("id, name").in("id", personIds);
      hostessRows = Array.isArray(hostessFallback.data) ? hostessFallback.data : [];
      hostessErr = hostessFallback.error;
    }
    if (!hostessErr) {
      for (const row of hostessRows) {
        const personId = String((row as any)?.id ?? "").trim();
        const personName =
          normalizeOptionalText((row as any)?.alias_name) ??
          normalizeOptionalText((row as any)?.name);
        if (isUuid(personId) && personName) personNameById.set(personId, personName);
      }
    }

    let profileRows: any[] = [];
    let profileErr: unknown = null;
    const profilePrimary = await args.supabase.from("profiles").select("id, nickname, full_name").in("id", personIds);
    profileRows = Array.isArray(profilePrimary.data) ? profilePrimary.data : [];
    profileErr = profilePrimary.error;
    if (profileErr && isMissingColumn(profileErr, ["nickname", "full_name"])) {
      const profileFallback = await args.supabase.from("profiles").select("id").in("id", personIds);
      profileRows = Array.isArray(profileFallback.data) ? profileFallback.data : [];
      profileErr = profileFallback.error;
    }
    if (!profileErr) {
      for (const row of profileRows) {
        const personId = String((row as any)?.id ?? "").trim();
        if (!isUuid(personId) || personNameById.has(personId)) continue;
        const personName =
          normalizeOptionalText((row as any)?.nickname) ??
          normalizeOptionalText((row as any)?.full_name);
        if (personName) personNameById.set(personId, personName);
      }
    }
  }

  for (const [deviceUid, deviceId] of Array.from(deviceIdByUid.entries())) {
    const personId = personIdByDeviceId.get(deviceId);
    const personName = personId ? personNameById.get(personId) ?? null : null;
    if (!personId || !personName) continue;
    out.set(deviceUid, {
      device_id: deviceId,
      person_id: personId,
      person_name: personName,
    });
  }
  return out;
}

async function loadRecentPresenceCandidateRows(args: {
  supabase: any;
  storeUuid: string;
  roomUuid?: string;
  hostessUuid?: string;
}) {
  const lookbackCutoffIso = new Date(Date.now() - EXIT_WARNING_LOOKBACK_SECONDS * 1000).toISOString();
  let query = args.supabase
    .from("ble_tag_presence")
    .select("hostess_id, minor, room_uuid, last_seen_at")
    .eq("store_uuid", args.storeUuid)
    .not("room_uuid", "is", null)
    .gte("last_seen_at", lookbackCutoffIso)
    .order("last_seen_at", { ascending: false });
  if (isUuid(args.roomUuid)) {
    query = query.eq("room_uuid", args.roomUuid);
  }
  if (isUuid(args.hostessUuid)) {
    query = query.eq("hostess_id", args.hostessUuid);
  }
  const result = await query;
  if (
    result.error &&
    !(
      isMissingTableOrSchemaCache(result.error, ["public.ble_tag_presence", "ble_tag_presence"]) ||
      isMissingColumn(result.error, ["hostess_id", "minor", "room_uuid", "last_seen_at"])
    )
  ) {
    return [] as RecentPresenceCandidateRow[];
  }
  if (result.error || !Array.isArray(result.data)) return [] as RecentPresenceCandidateRow[];
  return result.data.map((row: any) => ({
    hostess_id: String((row as any)?.hostess_id ?? "").trim() || null,
    beacon_minor: Number((row as any)?.minor ?? NaN),
    room_uuid: String((row as any)?.room_uuid ?? "").trim() || null,
    last_seen_at: String((row as any)?.last_seen_at ?? "").trim() || null,
  })) as RecentPresenceCandidateRow[];
}

async function enrichPresenceRoomsWithAssignedPeopleAndWarnings(args: {
  supabase: any;
  storeUuid: string;
  rooms: PresenceRoomProjection[];
  roomUuid?: string;
  hostessUuid?: string;
}) {
  const activeRooms = Array.isArray(args.rooms) ? args.rooms : [];
  const recentPresenceRows = await loadRecentPresenceCandidateRows({
    supabase: args.supabase,
    storeUuid: args.storeUuid,
    roomUuid: args.roomUuid,
    hostessUuid: args.hostessUuid,
  });

  const deviceUids = Array.from(
    new Set(
      [
        ...activeRooms.flatMap((room) =>
          (Array.isArray(room.present_hostesses) ? room.present_hostesses : [])
            .map((hostess) => toDeviceUid(hostess?.beacon_minor))
            .filter((value): value is string => Boolean(value))
        ),
        ...recentPresenceRows
          .map((row) => toDeviceUid(row.beacon_minor))
          .filter((value): value is string => Boolean(value)),
      ]
    )
  );
  const roomUuids = Array.from(
    new Set(
      [
        ...activeRooms.map((room) => String(room.room_uuid ?? "").trim()),
        ...recentPresenceRows.map((row) => String(row.room_uuid ?? "").trim()),
      ].filter((value) => isUuid(value))
    )
  );
  const hostessIds = Array.from(
    new Set(
      recentPresenceRows
        .map((row) => String(row.hostess_id ?? "").trim())
        .filter((value) => isUuid(value))
    )
  );

  const [assignedByDeviceUid, roomInfoMap, hostessNameMap] = await Promise.all([
    loadAssignedDeviceDirectory({
      supabase: args.supabase,
      storeUuid: args.storeUuid,
      deviceUids,
    }),
    loadRoomInfoMap({
      supabase: args.supabase,
      roomUuids,
    }),
    loadHostessNameMap({
      supabase: args.supabase,
      hostessIds,
    }),
  ]);

  const roomsByUuid = new Map<string, PresenceRoomResponse>();
  const activeDeviceUids = new Set<string>();
  const nowMs = Date.now();

  for (const room of activeRooms) {
    const roomUuid = String(room.room_uuid ?? "").trim();
    if (!isUuid(roomUuid)) continue;
    const roomInfo = roomInfoMap.get(roomUuid);
    const seenNames = new Set<string>();
    const people = Array.isArray((room as any)?.people)
      ? (room as any).people
          .map((name: unknown) => String(name ?? "").trim())
          .filter((name: string) => name !== "")
      : [];
    for (const personName of people) seenNames.add(personName);
    for (const hostess of Array.isArray(room.present_hostesses) ? room.present_hostesses : []) {
      const deviceUid = toDeviceUid(hostess?.beacon_minor);
      if (!deviceUid) continue;
      const hostessLastSeenAt = toIsoOrNull(hostess?.last_seen_at);
      const hostessLastSeenMs = hostessLastSeenAt ? Date.parse(hostessLastSeenAt) : NaN;
      if (
        hostessLastSeenAt &&
        Number.isFinite(hostessLastSeenMs) &&
        nowMs - hostessLastSeenMs <= BLE_TAG_PRESENCE_ACTIVE_SECONDS * 1000
      ) {
        activeDeviceUids.add(deviceUid);
      }
      const personName = assignedByDeviceUid.get(deviceUid)?.person_name ?? null;
      if (!personName || seenNames.has(personName)) continue;
      seenNames.add(personName);
      people.push(personName);
    }
    roomsByUuid.set(roomUuid, {
      room_uuid: roomUuid,
      room_no: room.room_no ?? roomInfo?.room_no ?? null,
      room_name: room.room_name ?? roomInfo?.room_name ?? buildFallbackRoomName(room.room_no ?? roomInfo?.room_no ?? null),
      gateway_id: room.gateway_id ?? null,
      present_hostesses: Array.isArray(room.present_hostesses) ? room.present_hostesses : [],
      count: Array.isArray(room.present_hostesses) ? room.present_hostesses.length : 0,
      people,
      warnings: Array.isArray((room as any)?.warnings) ? (room as any).warnings : [],
      latest_seen_at: pickLatestIso(
        [
          toIsoOrNull((room as any)?.latest_seen_at),
          ...(Array.isArray(room.present_hostesses) ? room.present_hostesses : []).map((hostess) =>
            toIsoOrNull(hostess?.last_seen_at)
          ),
        ]
      ),
    });
  }

  const warningDedup = new Set<string>();
  for (const row of recentPresenceRows) {
    const roomUuid = String(row.room_uuid ?? "").trim();
    const deviceUid = toDeviceUid(row.beacon_minor);
    const lastSeenAt = toIsoOrNull(row.last_seen_at);
    if (!isUuid(roomUuid) || !deviceUid || !lastSeenAt) continue;
    if (activeDeviceUids.has(deviceUid)) continue;
    const lastSeenMs = Date.parse(lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) continue;
    const ageMs = nowMs - lastSeenMs;
    if (ageMs < BLE_TAG_PRESENCE_ACTIVE_SECONDS * 1000 || ageMs > EXIT_WARNING_LOOKBACK_SECONDS * 1000) continue;
    const hostessId = String(row.hostess_id ?? "").trim();
    const hostessMeta = isUuid(hostessId) ? hostessNameMap.get(hostessId) ?? null : null;
    const personName =
      assignedByDeviceUid.get(deviceUid)?.person_name ??
      hostessMeta?.alias_name ??
      hostessMeta?.real_name ??
      null;
    if (!personName) continue;
    const warningKey = `${roomUuid}:${deviceUid}`;
    if (warningDedup.has(warningKey)) continue;
    warningDedup.add(warningKey);

    const roomInfo = roomInfoMap.get(roomUuid);
    const roomEntry =
      roomsByUuid.get(roomUuid) ??
      {
        room_uuid: roomUuid,
        room_no: roomInfo?.room_no ?? null,
        room_name: roomInfo?.room_name ?? buildFallbackRoomName(roomInfo?.room_no ?? null),
        gateway_id: null,
        present_hostesses: [],
        count: 0,
        people: [],
        warnings: [],
        latest_seen_at: null,
      };
    roomEntry.warnings.push({
      type: "exit_candidate",
      person_name: personName,
      device_uid: deviceUid,
      last_seen_at: lastSeenAt,
      grace_seconds: Math.max(EXIT_WARNING_GRACE_SECONDS, BLE_TAG_PRESENCE_ACTIVE_SECONDS),
    });
    roomEntry.latest_seen_at = pickLatestIso([roomEntry.latest_seen_at, lastSeenAt]);
    roomsByUuid.set(roomUuid, roomEntry);
    logBleExitCandidate({
      room_uuid: roomUuid,
      device_uid: deviceUid,
      person_name: personName,
      last_seen_at: lastSeenAt,
      age_ms: ageMs,
      active_after_ms: BLE_TAG_PRESENCE_ACTIVE_SECONDS * 1000,
      lookback_ms: EXIT_WARNING_LOOKBACK_SECONDS * 1000,
    });
  }

  return Array.from(roomsByUuid.values()).sort(comparePresenceRoom);
}

export async function GET(req: Request) {
  try {
    logBlePresenceTrace("start", {
      step: "start",
      route: "/api/ops/ble/presence",
    });
    const ctx = await requireRouteRole({
      req,
      route: "/api/ops/ble/presence",
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;
    const { supabase, profile, context } = ctx;
    const profileStoreUuid =
      typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    logBlePresenceTrace("after_auth", {
      step: "after_auth",
      auth_user_id: context.user.id ?? null,
      profile_id: profile?.id ?? null,
      profile_role: profile?.role ?? null,
      profile_store_uuid: profileStoreUuid || null,
    });
    logBlePresenceTrace("role_pass", {
      step: "role_pass",
      profile_role: profile?.role ?? null,
    });
    if (!isUuid(profileStoreUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const url = new URL(req.url);
    const gatewayId = String(url.searchParams.get("gateway_id") ?? "").trim();
    const roomUuid = String(url.searchParams.get("room_uuid") ?? "").trim();
    const hostessUuid = String(url.searchParams.get("hostess_uuid") ?? "").trim();
    const activeOnly = parseBool(url.searchParams.get("active_only"));
    const limit = parseLimit(url.searchParams.get("limit"));

    const tagPresence = await loadBleTagPresenceRooms({
      supabase,
      storeUuid: profileStoreUuid,
      activeOnly,
      limit,
      gatewayId: gatewayId || undefined,
      roomUuid: roomUuid || undefined,
      hostessUuid: hostessUuid || undefined,
    });
    if (tagPresence.ok) {
      const enrichedRooms = await enrichPresenceRoomsWithAssignedPeopleAndWarnings({
        supabase,
        storeUuid: profileStoreUuid,
        rooms: tagPresence.rooms,
        roomUuid: roomUuid || undefined,
        hostessUuid: hostessUuid || undefined,
      });
      console.log("[BLE_PRESENCE_SOURCE]", {
        source: "ble_tag_presence",
        fallback_reason: null,
      });
      logBlePresenceTrace("before_response", {
        step: "before_response",
        row_count: tagPresence.rows.length,
        room_count: enrichedRooms.length,
        fallback: "ble_tag_presence",
      });
      return NextResponse.json({ ok: true, rows: tagPresence.rows, rooms: enrichedRooms }, { status: 200 });
    }

    logBlePresenceRouteTrace("fallback_triggered", {
      step: "fallback_triggered",
      reason: tagPresence.reason,
      source: "ble_tag_presence",
    });
    logBlePresenceRouteTrace("zone_source_start", { step: "zone_source_start" });
    const zoneDerived = await loadZoneDerivedRoomPresence({
      supabase,
      storeUuid: profileStoreUuid,
      activeOnly,
      limit,
      gatewayId: gatewayId || undefined,
      roomUuid: roomUuid || undefined,
      hostessUuid: hostessUuid || undefined,
    });
    if (zoneDerived.ok) {
      const enrichedRooms = await enrichPresenceRoomsWithAssignedPeopleAndWarnings({
        supabase,
        storeUuid: profileStoreUuid,
        rooms: zoneDerived.rooms,
        roomUuid: roomUuid || undefined,
        hostessUuid: hostessUuid || undefined,
      });
      logBlePresenceRouteTrace("zone_source_success", {
        rows: zoneDerived.rows.length,
      });
      console.log("[BLE_PRESENCE_SOURCE]", {
        source: "zone_current",
        fallback_reason: tagPresence.reason,
      });
      logBlePresenceTrace("before_response", {
        step: "before_response",
        row_count: zoneDerived.rows.length,
        room_count: enrichedRooms.length,
        fallback: "zone_current",
      });
      logBlePresenceRouteDebug(
        `${profileStoreUuid}:${gatewayId || "all"}:${roomUuid || "all"}:${hostessUuid || "all"}:${activeOnly}:${limit}`,
        {
          rowCount: zoneDerived.rows.length,
          roomsCount: enrichedRooms.length,
          firstRoom: enrichedRooms[0] ?? null,
          activeRoomUuids: enrichedRooms.slice(0, 5).map((room) => room.room_uuid),
        }
      );
      return NextResponse.json({ ok: true, rows: zoneDerived.rows, rooms: enrichedRooms }, { status: 200 });
    }
    console.log("[BLE_PRESENCE_SOURCE]", {
      source: "zone_current",
      fallback_reason: zoneDerived.reason,
    });
    return NextResponse.json(
      { ok: false, error: zoneDerived.fallback ? "ZONE_SOURCE_FALLBACK_BLOCKED" : "DB_ERROR", message: zoneDerived.reason },
      { status: 500 }
    );
  } catch (error) {
    logBlePresenceTrace("catch", {
      step: "catch",
      message: error instanceof Error ? error.message : String(error),
    });
    console.error("[BLE_PRESENCE_EXCEPTION]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

