import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyProfileOrNull } from "@/lib/auth/getMyProfile";
import { getServerSupabaseOrError } from "@/lib/supabaseServer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STALE_MS = 60_000;

export type PresenceStatus = "present" | "missing" | "ghost";

export type ReconciledParticipant = {
  hostess_id: string;
  name?: string | null;
  in_session: boolean;
  in_ble: boolean;
  effective_in_ble?: boolean;
  status: PresenceStatus;
  last_seen_at?: string | null;
  is_stale_ble?: boolean;
};

export type ReconciledRoom = {
  room_uuid: string;
  session_id?: string | null;
  participants: ReconciledParticipant[];
  counts: {
    present: number;
    missing: number;
    ghost: number;
  };
};

type ResolveRoomPresenceScopedArgs = {
  supabase: SupabaseClient;
  room_uuid: string;
  store_uuid: string;
};

type RoomSessionRow = {
  id: string;
  started_at?: string | null;
};

type SessionParticipantRow = {
  hostess_id: string | null;
  status?: string | null;
  left_at?: string | null;
  exit_at?: string | null;
  created_at?: string | null;
};

type PresenceRow = {
  hostess_id: string | null;
  last_seen_at?: string | null;
};

type BlePresenceMeta = {
  in_ble: boolean;
  effective_in_ble: boolean;
  last_seen_at: string | null;
  is_stale_ble: boolean;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function normalizeUuid(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  return message.includes(columnName.toLowerCase()) && message.includes("column");
}

function isActiveSessionParticipant(row: SessionParticipantRow): boolean {
  const status = String(row.status ?? "").trim().toLowerCase();
  const leftAt = normalizeOptionalText(row.left_at ?? row.exit_at);
  if (status === "closed") return false;
  if (leftAt) return false;
  return true;
}

function compareIsoDesc(left: string | null | undefined, right: string | null | undefined): number {
  const leftMs = Date.parse(String(left ?? ""));
  const rightMs = Date.parse(String(right ?? ""));
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeRight - safeLeft;
}

function isStaleBlePresence(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return true;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return true;
  return nowMs - lastSeenMs > STALE_MS;
}

async function loadOpenRoomSession(args: ResolveRoomPresenceScopedArgs): Promise<RoomSessionRow | null> {
  const { data, error } = await args.supabase
    .from("room_sessions")
    .select("id, started_at")
    .eq("room_uuid", args.room_uuid)
    .eq("store_uuid", args.store_uuid)
    .eq("status", "open")
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const rows = Array.isArray(data) ? (data as RoomSessionRow[]) : [];
  const first = rows[0] ?? null;
  if (!first || !isUuid(first.id)) return null;
  return first;
}

async function loadSessionHostessIds(
  args: ResolveRoomPresenceScopedArgs & { session_id: string | null }
): Promise<string[]> {
  if (!isUuid(args.session_id)) return [];

  const primary = await args.supabase
    .from("session_participants")
    .select("hostess_id, status, left_at, created_at")
    .eq("session_id", args.session_id)
    .order("created_at", { ascending: false });

  let rows = Array.isArray(primary.data) ? (primary.data as SessionParticipantRow[]) : [];
  let error = primary.error;

  if (error && isMissingColumnError(error, "left_at")) {
    const fallback = await args.supabase
      .from("session_participants")
      .select("hostess_id, status, exit_at, created_at")
      .eq("session_id", args.session_id)
      .order("created_at", { ascending: false });
    rows = Array.isArray(fallback.data) ? (fallback.data as SessionParticipantRow[]) : [];
    error = fallback.error;
  }

  if (error) throw error;

  const seen = new Set<string>();
  const hostessIds: string[] = [];
  for (const row of rows) {
    const hostessId = normalizeUuid(row.hostess_id);
    if (!isUuid(hostessId)) continue;
    if (!isActiveSessionParticipant(row)) continue;
    if (seen.has(hostessId)) continue;
    seen.add(hostessId);
    hostessIds.push(hostessId);
  }
  return hostessIds;
}

async function loadBlePresenceMap(args: ResolveRoomPresenceScopedArgs): Promise<Map<string, BlePresenceMeta>> {
  const nowMs = Date.now();
  const { data, error } = await args.supabase
    .from("hostess_presence")
    .select("hostess_id, last_seen_at")
    .eq("store_uuid", args.store_uuid)
    .eq("room_uuid", args.room_uuid)
    .eq("presence_status", "present")
    .order("last_seen_at", { ascending: false });

  if (error) throw error;

  const rows = Array.isArray(data) ? (data as PresenceRow[]) : [];
  const presenceByHostessId = new Map<string, BlePresenceMeta>();
  for (const row of rows) {
    const hostessId = normalizeUuid(row.hostess_id);
    if (!isUuid(hostessId)) continue;
    if (presenceByHostessId.has(hostessId)) continue;
    const lastSeenAt = normalizeOptionalText(row.last_seen_at);
    const isStaleBle = isStaleBlePresence(lastSeenAt, nowMs);
    presenceByHostessId.set(hostessId, {
      in_ble: true,
      effective_in_ble: !isStaleBle,
      last_seen_at: lastSeenAt,
      is_stale_ble: isStaleBle,
    });
  }
  return presenceByHostessId;
}

async function loadHostessNameMap(supabase: SupabaseClient, hostessIds: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (hostessIds.length <= 0) return nameMap;

  const primary = await supabase.from("hostesses").select("id, alias_name").in("id", hostessIds);
  let rows: Array<Record<string, unknown>> = Array.isArray(primary.data) ? (primary.data as Array<Record<string, unknown>>) : [];
  let error = primary.error;
  let useAliasName = true;

  if (error && isMissingColumnError(error, "alias_name")) {
    const fallback = await supabase.from("hostesses").select("id, name").in("id", hostessIds);
    rows = Array.isArray(fallback.data) ? (fallback.data as Array<Record<string, unknown>>) : [];
    error = fallback.error;
    useAliasName = false;
  }

  if (error) return nameMap;

  for (const row of rows) {
    const hostessId = normalizeUuid((row as { id?: unknown })?.id);
    if (!isUuid(hostessId)) continue;
    const name = normalizeOptionalText(
      useAliasName ? (row as { alias_name?: unknown })?.alias_name : (row as { name?: unknown })?.name
    );
    if (!name) continue;
    nameMap.set(hostessId, name);
  }

  return nameMap;
}

function buildPresenceStatus(inSession: boolean, inBle: boolean): PresenceStatus {
  if (inSession && inBle) return "present";
  if (inSession) return "missing";
  return "ghost";
}

export async function resolveRoomPresence(room_uuid: string): Promise<ReconciledRoom> {
  const normalizedRoomUuid = normalizeUuid(room_uuid);
  if (!isUuid(normalizedRoomUuid)) {
    throw new Error("INVALID_ROOM_UUID");
  }

  const profile = await getMyProfileOrNull();
  if (!profile?.id) {
    throw new Error("UNAUTHENTICATED");
  }

  const storeUuid = normalizeUuid(profile.store_uuid);
  if (!isUuid(storeUuid)) {
    throw new Error("PROFILE_STORE_REQUIRED");
  }

  const cookieStore = await cookies();
  const result = getServerSupabaseOrError(cookieStore);
  if ("error" in result) {
    throw new Error("SUPABASE_CLIENT_UNAVAILABLE");
  }

  return resolveRoomPresenceScoped({
    supabase: result.supabase,
    room_uuid: normalizedRoomUuid,
    store_uuid: storeUuid,
  });
}

export async function resolveRoomPresenceScoped(args: ResolveRoomPresenceScopedArgs): Promise<ReconciledRoom> {
  const roomUuid = normalizeUuid(args.room_uuid);
  const storeUuid = normalizeUuid(args.store_uuid);
  if (!isUuid(roomUuid)) {
    throw new Error("INVALID_ROOM_UUID");
  }
  if (!isUuid(storeUuid)) {
    throw new Error("INVALID_STORE_UUID");
  }

  const openSession = await loadOpenRoomSession({
    supabase: args.supabase,
    room_uuid: roomUuid,
    store_uuid: storeUuid,
  });
  const sessionId = openSession?.id ?? null;
  const [sessionHostessIds, blePresenceByHostessId] = await Promise.all([
    loadSessionHostessIds({
      supabase: args.supabase,
      room_uuid: roomUuid,
      store_uuid: storeUuid,
      session_id: sessionId,
    }),
    loadBlePresenceMap({
      supabase: args.supabase,
      room_uuid: roomUuid,
      store_uuid: storeUuid,
    }),
  ]);

  const unionHostessIds = Array.from(
    new Set(
      [
        ...sessionHostessIds,
        ...Array.from(blePresenceByHostessId.entries())
          .filter(([, meta]) => meta.effective_in_ble)
          .map(([hostessId]) => hostessId),
      ].filter((value) => isUuid(value))
    )
  );
  const hostessNameById = await loadHostessNameMap(args.supabase, unionHostessIds);
  const sessionHostessIdSet = new Set(sessionHostessIds);

  const participants = unionHostessIds
    .map((hostessId) => {
      const blePresenceMeta = blePresenceByHostessId.get(hostessId);
      const inSession = sessionHostessIdSet.has(hostessId);
      const inBle = blePresenceMeta?.in_ble ?? false;
      const effectiveInBle = blePresenceMeta?.effective_in_ble ?? false;
      return {
        hostess_id: hostessId,
        name: hostessNameById.get(hostessId) ?? null,
        in_session: inSession,
        in_ble: inBle,
        effective_in_ble: effectiveInBle,
        status: buildPresenceStatus(inSession, effectiveInBle),
        last_seen_at: blePresenceMeta?.last_seen_at ?? null,
        is_stale_ble: blePresenceMeta?.is_stale_ble ?? false,
      } satisfies ReconciledParticipant;
    })
    .sort((left, right) => {
      const statusOrder: Record<PresenceStatus, number> = {
        missing: 0,
        ghost: 1,
        present: 2,
      };
      const statusDiff = statusOrder[left.status] - statusOrder[right.status];
      if (statusDiff !== 0) return statusDiff;
      const nameLeft = String(left.name ?? left.hostess_id).trim().toLowerCase();
      const nameRight = String(right.name ?? right.hostess_id).trim().toLowerCase();
      if (nameLeft !== nameRight) return nameLeft.localeCompare(nameRight, "ko");
      return compareIsoDesc(left.last_seen_at, right.last_seen_at);
    });

  return {
    room_uuid: roomUuid,
    session_id: sessionId,
    participants,
    counts: {
      present: participants.filter((participant) => participant.status === "present").length,
      missing: participants.filter((participant) => participant.status === "missing").length,
      ghost: participants.filter((participant) => participant.status === "ghost").length,
    },
  } satisfies ReconciledRoom;
}
