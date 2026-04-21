import { NextResponse } from "next/server";
import { requireRouteRole } from "@/lib/security/requireRole";
import type { BleMonitorSessionParticipantRow, BleMonitorSessionRow } from "@/lib/ops/ble/monitorPresentation";

export const dynamic = "force-dynamic";

const ROUTE = "/api/ops/ble/monitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function formatAnyError(error: unknown): string {
  if (error instanceof Error) return String(error.message ?? "").trim() || "UNKNOWN_ERROR";
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    return [obj.code, obj.message, obj.details, obj.hint]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(" ") || "UNKNOWN_ERROR";
  }
  return typeof error === "string" ? error.trim() || "UNKNOWN_ERROR" : "UNKNOWN_ERROR";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const text = formatAnyError(error).toLowerCase();
  return text.includes(columnName.toLowerCase()) && (text.includes("column") || text.includes("schema"));
}

function extractRelationRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return value ?? null;
}

function toInt(value: unknown): number {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

type RoomSessionQueryRow = {
  id: string;
  room_uuid: string;
  started_at: string | null;
  status: string | null;
  manager_id?: string | null;
  rooms?:
    | {
        id: string;
        room_no?: number | null;
        name?: string | null;
        store_uuid?: string | null;
      }
    | Array<{
        id: string;
        room_no?: number | null;
        name?: string | null;
        store_uuid?: string | null;
      }>
    | null;
};

export async function GET(req: Request) {
  try {
    const ctx = await requireRouteRole({
      req,
      route: ROUTE,
      roles: ["admin", "store_owner", "manager", "counter", "ops"],
    });
    if ("response" in ctx) return ctx.response;

    const { supabase, profile } = ctx;
    const storeUuid = typeof profile?.store_uuid === "string" ? profile.store_uuid.trim() : "";
    if (!isUuid(storeUuid)) {
      return NextResponse.json({ ok: false, error: "PROFILE_STORE_UUID_REQUIRED" }, { status: 403 });
    }

    const runSessionQuery = async (selectClause: string) => {
      return supabase
        .from("room_sessions")
        .select(selectClause)
        .eq("store_uuid", storeUuid)
        .eq("status", "open")
        .order("started_at", { ascending: false })
        .limit(200);
    };

    let roomSessionsRes = await runSessionQuery("id, room_uuid, started_at, status, manager_id, rooms!inner(id, room_no, name, store_uuid)");
    if (roomSessionsRes.error && isMissingColumnError(roomSessionsRes.error, "manager_id")) {
      roomSessionsRes = await runSessionQuery("id, room_uuid, started_at, status, rooms!inner(id, room_no, name, store_uuid)");
    }
    if (roomSessionsRes.error && isMissingColumnError(roomSessionsRes.error, "name")) {
      roomSessionsRes = await runSessionQuery("id, room_uuid, started_at, status, rooms!inner(id, room_no, store_uuid)");
    }
    if (roomSessionsRes.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(roomSessionsRes.error) },
        { status: 500 }
      );
    }

    const roomSessionRows = Array.isArray(roomSessionsRes.data) ? (roomSessionsRes.data as unknown as RoomSessionQueryRow[]) : [];
    const sessions = roomSessionRows
      .map((row) => {
        const sessionId = String(row.id ?? "").trim();
        const roomUuid = String(row.room_uuid ?? "").trim();
        if (!isUuid(sessionId) || !isUuid(roomUuid)) return null;
        const room = extractRelationRow((row as RoomSessionQueryRow).rooms);
        return {
          session_id: sessionId,
          room_uuid: roomUuid,
          room_no: Number.isFinite(Number(room?.room_no ?? NaN)) ? Math.trunc(Number(room?.room_no)) : null,
          room_name: normalizeText(room?.name),
          started_at: normalizeText(row.started_at),
          status: normalizeText(row.status) ?? "open",
          manager_id: isUuid(row.manager_id) ? row.manager_id : null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    if (sessions.length === 0) {
      return NextResponse.json({ ok: true, rows: [] as BleMonitorSessionRow[] }, { status: 200 });
    }

    let participantsRes: { data: any[] | null; error: unknown } = await supabase
      .from("session_participants")
      .select("id, session_id, hostess_id, manager_id, entered_at, left_at, status, category, time_minutes")
      .in("session_id", sessions.map((row) => row.session_id))
      .order("entered_at", { ascending: true });
    if (participantsRes.error && isMissingColumnError(participantsRes.error, "category")) {
      participantsRes = await supabase
        .from("session_participants")
        .select("id, session_id, hostess_id, manager_id, entered_at, left_at, status, time_minutes")
        .in("session_id", sessions.map((row) => row.session_id))
        .order("entered_at", { ascending: true });
    }
    if (participantsRes.error && isMissingColumnError(participantsRes.error, "time_minutes")) {
      participantsRes = await supabase
        .from("session_participants")
        .select("id, session_id, hostess_id, manager_id, entered_at, left_at, status")
        .in("session_id", sessions.map((row) => row.session_id))
        .order("entered_at", { ascending: true });
    }
    if (participantsRes.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(participantsRes.error) },
        { status: 500 }
      );
    }

    const participantRows = Array.isArray(participantsRes.data) ? (participantsRes.data as any[]) : [];
    const managerIds = Array.from(
      new Set(
        [
          ...sessions.map((row) => String(row.manager_id ?? "").trim()),
          ...participantRows.map((row) => String(row?.manager_id ?? "").trim()),
        ].filter((value) => isUuid(value))
      )
    );
    const hostessIds = Array.from(
      new Set(participantRows.map((row) => String(row?.hostess_id ?? "").trim()).filter((value) => isUuid(value)))
    );

    const [managerLookup, hostessLookupInitial] = await Promise.all([
      managerIds.length > 0 ? supabase.from("managers").select("id, name").in("id", managerIds) : Promise.resolve({ data: [], error: null }),
      hostessIds.length > 0 ? supabase.from("hostesses").select("id, alias_name").in("id", hostessIds) : Promise.resolve({ data: [], error: null }),
    ]);

    let hostessLookup = hostessLookupInitial as { data: any[] | null; error: unknown };
    if (hostessLookupInitial.error && isMissingColumnError(hostessLookupInitial.error, "alias_name")) {
      hostessLookup = hostessIds.length > 0
        ? await supabase.from("hostesses").select("id, name").in("id", hostessIds)
        : { data: [], error: null };
    }
    if (managerLookup.error || hostessLookup.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: formatAnyError(managerLookup.error ?? hostessLookup.error) },
        { status: 500 }
      );
    }

    const managerNameById = new Map<string, string>();
    for (const row of Array.isArray(managerLookup.data) ? managerLookup.data : []) {
      const id = String((row as any)?.id ?? "").trim();
      const name = String((row as any)?.name ?? "").trim();
      if (isUuid(id) && name) managerNameById.set(id, name);
    }

    const hostessNameById = new Map<string, string>();
    for (const row of Array.isArray(hostessLookup.data) ? hostessLookup.data : []) {
      const id = String((row as any)?.id ?? "").trim();
      const hostessName = String((row as any)?.alias_name ?? (row as any)?.name ?? "").trim();
      if (isUuid(id) && hostessName) hostessNameById.set(id, hostessName);
    }

    const participantsBySessionId = new Map<string, BleMonitorSessionParticipantRow[]>();
    const latestManagerIdBySessionId = new Map<string, string | null>();
    for (const row of participantRows) {
      const sessionId = String(row?.session_id ?? "").trim();
      if (!isUuid(sessionId)) continue;
      const participant: BleMonitorSessionParticipantRow = {
        id: String(row?.id ?? "").trim(),
        hostess_id: isUuid(row?.hostess_id) ? String(row.hostess_id).trim() : null,
        hostess_name: isUuid(row?.hostess_id) ? hostessNameById.get(String(row.hostess_id).trim()) ?? null : null,
        manager_id: isUuid(row?.manager_id) ? String(row.manager_id).trim() : null,
        manager_name: isUuid(row?.manager_id) ? managerNameById.get(String(row.manager_id).trim()) ?? null : null,
        entered_at: normalizeText(row?.entered_at),
        left_at: normalizeText(row?.left_at),
        status: normalizeText(row?.status),
        category: normalizeText(row?.category),
        time_minutes: Math.max(0, toInt(row?.time_minutes)),
      };
      const list = participantsBySessionId.get(sessionId) ?? [];
      list.push(participant);
      participantsBySessionId.set(sessionId, list);
      if (!latestManagerIdBySessionId.has(sessionId) && participant.manager_id) {
        latestManagerIdBySessionId.set(sessionId, participant.manager_id);
      }
    }

    const rows: BleMonitorSessionRow[] = sessions.map((session) => {
      const fallbackManagerId = latestManagerIdBySessionId.get(session.session_id) ?? null;
      const effectiveManagerId = session.manager_id ?? fallbackManagerId;
      return {
        session_id: session.session_id,
        room_uuid: session.room_uuid,
        room_no: session.room_no,
        room_name: session.room_name,
        started_at: session.started_at,
        status: session.status,
        manager_id: effectiveManagerId,
        manager_name: effectiveManagerId ? managerNameById.get(effectiveManagerId) ?? null : null,
        participants: participantsBySessionId.get(session.session_id) ?? [],
      };
    });

    return NextResponse.json({ ok: true, rows }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: formatAnyError(error) },
      { status: 500 }
    );
  }
}
