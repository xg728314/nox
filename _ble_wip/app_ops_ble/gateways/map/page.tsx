"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type GatewayRow = {
  gateway_id: string;
  gateway_type: string;
  display_name: string | null;
  room_uuid: string | null;
  store_uuid: string | null;
  is_active: boolean;
  last_heartbeat_at: string | null;
};

type GatewayStatus = "UNASSIGNED" | "DISABLED" | "ALIVE" | "STALE" | "OFFLINE";
type ZoneGroup = "ROOM" | "HALL" | "BUILDING" | "COUNTER" | "SPARE";
type AssignedFilter = "ALL" | "ASSIGNED" | "UNASSIGNED";

const FLOOR_UNKNOWN = "UNKNOWN";
const ZONE_ORDER: ZoneGroup[] = ["ROOM", "HALL", "BUILDING", "COUNTER", "SPARE"];
const STATUS_ORDER: GatewayStatus[] = ["UNASSIGNED", "DISABLED", "ALIVE", "STALE", "OFFLINE"];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function classifyStatus(row: Pick<GatewayRow, "room_uuid" | "is_active" | "last_heartbeat_at">): GatewayStatus {
  if (!normalizeText(row.room_uuid)) return "UNASSIGNED";
  if (!row.is_active) return "DISABLED";
  const raw = normalizeText(row.last_heartbeat_at);
  if (!raw) return "OFFLINE";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms <= 0) return "OFFLINE";
  const ageSec = Math.max(0, Math.trunc((Date.now() - ms) / 1000));
  if (ageSec < 60) return "ALIVE";
  if (ageSec <= 180) return "STALE";
  return "OFFLINE";
}

function statusBadgeClass(status: GatewayStatus): string {
  if (status === "UNASSIGNED") return "rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200";
  if (status === "DISABLED") return "rounded border border-zinc-500/40 bg-zinc-500/10 px-2 py-0.5 text-xs text-zinc-300";
  if (status === "ALIVE") return "rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200";
  if (status === "STALE") return "rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200";
  return "rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-200";
}

function formatDateTime(value: string | null | undefined): string {
  const raw = normalizeText(value);
  if (!raw) return "-";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleString("ko-KR", { hour12: false });
}

function formatRelativeSeconds(value: string | null | undefined): string {
  const raw = normalizeText(value);
  if (!raw) return "-";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return "-";
  const diffSec = Math.max(0, Math.trunc((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s 전`;
  const diffMin = Math.trunc(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m 전`;
  const diffHour = Math.trunc(diffMin / 60);
  return `${diffHour}h 전`;
}

function detectFloor(row: GatewayRow): string {
  const text = [row.display_name, row.gateway_id, row.gateway_type].map(normalizeText).join(" ");
  const floorToken = text.match(/(?:^|[^A-Z0-9])(B\d{1,2}|[1-9]\d?\s*F|[1-9]\d?\s*층)\b/i)?.[1] ?? "";
  const normalizedFloorToken = normalizeText(floorToken).toUpperCase().replace(/\s+/g, "");
  if (normalizedFloorToken) {
    if (normalizedFloorToken.endsWith("층")) return `${normalizedFloorToken.slice(0, -1)}F`;
    return normalizedFloorToken;
  }

  const roomHint = text.match(/\b([1-9]\d{2})\b/)?.[1] ?? "";
  if (roomHint) {
    const floorNo = Number(roomHint.slice(0, -2));
    if (Number.isFinite(floorNo) && floorNo > 0) return `${floorNo}F`;
  }
  return FLOOR_UNKNOWN;
}

function detectZone(row: GatewayRow): ZoneGroup {
  const text = [row.display_name, row.gateway_id, row.gateway_type].map(normalizeText).join(" ").toLowerCase();
  if (/(hall|홀)/i.test(text)) return "HALL";
  if (/(building|lobby|gate|entrance|elevator|corridor|복도|출입구|입구|엘리베이터)/i.test(text)) return "BUILDING";
  if (/(counter|desk|front|카운터)/i.test(text)) return "COUNTER";
  if (/(spare|backup|reserve|stock|예비)/i.test(text)) return "SPARE";
  if (normalizeText(row.room_uuid)) return "ROOM";
  return "SPARE";
}

function floorSortValue(floor: string): number {
  if (floor === FLOOR_UNKNOWN) return Number.POSITIVE_INFINITY;
  const b = floor.match(/^B(\d{1,2})$/i);
  if (b) return -Number(b[1]);
  const f = floor.match(/^(\d{1,2})F$/i);
  if (f) return Number(f[1]);
  return Number.POSITIVE_INFINITY - 1;
}

export default function OpsBleGatewayMapPage() {
  const [rows, setRows] = useState<GatewayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [floorFilter, setFloorFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>("ALL");

  const loadRows = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await fetch("/api/ops/ble/gateways", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(String(json?.error ?? `HTTP_${res.status}`));
      }
      setRows(Array.isArray(json?.rows) ? (json.rows as GatewayRow[]) : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRows({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadRows]);

  const enrichedRows = useMemo(() => {
    return rows.map((row) => {
      const floor = detectFloor(row);
      const zone = detectZone(row);
      const status = classifyStatus(row);
      const assigned = normalizeText(row.room_uuid) !== "";
      return { ...row, floor, zone, status, assigned };
    });
  }, [rows]);

  const floorOptions = useMemo(() => {
    const values = Array.from(new Set(enrichedRows.map((row) => row.floor)));
    values.sort((a, b) => floorSortValue(a) - floorSortValue(b) || a.localeCompare(b));
    return values;
  }, [enrichedRows]);

  const typeOptions = useMemo(() => {
    const values = Array.from(new Set(enrichedRows.map((row) => normalizeText(row.gateway_type) || "generic")));
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }, [enrichedRows]);

  const filteredRows = useMemo(() => {
    return enrichedRows.filter((row) => {
      if (floorFilter !== "ALL" && row.floor !== floorFilter) return false;
      if (typeFilter !== "ALL" && normalizeText(row.gateway_type) !== typeFilter) return false;
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (assignedFilter === "ASSIGNED" && !row.assigned) return false;
      if (assignedFilter === "UNASSIGNED" && row.assigned) return false;
      return true;
    });
  }, [assignedFilter, enrichedRows, floorFilter, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const counts: Record<GatewayStatus, number> = {
      UNASSIGNED: 0,
      DISABLED: 0,
      ALIVE: 0,
      STALE: 0,
      OFFLINE: 0,
    };
    for (const row of filteredRows) counts[row.status] += 1;
    return counts;
  }, [filteredRows]);

  const grouped = useMemo(() => {
    const floorMap = new Map<string, Map<ZoneGroup, typeof filteredRows>>();
    for (const row of filteredRows) {
      const zoneMap = floorMap.get(row.floor) ?? new Map<ZoneGroup, typeof filteredRows>();
      const zoneRows = zoneMap.get(row.zone) ?? [];
      zoneRows.push(row);
      zoneMap.set(row.zone, zoneRows);
      floorMap.set(row.floor, zoneMap);
    }
    const floorEntries = Array.from(floorMap.entries()).sort(
      (a, b) => floorSortValue(a[0]) - floorSortValue(b[0]) || a[0].localeCompare(b[0])
    );
    return floorEntries.map(([floor, zoneMap]) => ({
      floor,
      zones: ZONE_ORDER.map((zone) => ({
        zone,
        rows: (zoneMap.get(zone) ?? []).sort((a, b) => a.gateway_id.localeCompare(b.gateway_id)),
      })).filter((z) => z.rows.length > 0),
    }));
  }, [filteredRows]);

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-zinc-400">
              <Link href="/ops/ble" className="text-cyan-200 underline underline-offset-2">
                OPS BLE Dashboard
              </Link>
              {" / "}
              <Link href="/ops/ble/gateways" className="text-cyan-200 underline underline-offset-2">
                Gateway Management
              </Link>
              {" / Installation Map"}
            </div>
            <h1 className="mt-1 text-xl font-semibold">BLE Gateway Installation / Operations Map</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadRows();
            }}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
          >
            새로고침
          </button>
        </div>
        {error ? (
          <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            오류: {error}
          </div>
        ) : null}
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUS_ORDER.map((status) => (
          <div key={`summary-${status}`} className="rounded border border-zinc-700 bg-zinc-900 p-3">
            <div className="text-xs text-zinc-400">{status}</div>
            <div className={`mt-1 text-2xl font-semibold ${status === "UNASSIGNED" ? "text-sky-200" : status === "DISABLED" ? "text-zinc-200" : status === "ALIVE" ? "text-emerald-200" : status === "STALE" ? "text-amber-200" : "text-rose-200"}`}>
              {summary[status]}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-zinc-300">
            <div className="mb-1">Floor</div>
            <select
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-white"
            >
              <option value="ALL">ALL</option>
              {floorOptions.map((floor) => (
                <option key={`floor-opt-${floor}`} value={floor}>
                  {floor}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            <div className="mb-1">Gateway Type</div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-white"
            >
              <option value="ALL">ALL</option>
              {typeOptions.map((type) => (
                <option key={`type-opt-${type}`} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            <div className="mb-1">Status</div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-white"
            >
              <option value="ALL">ALL</option>
              {STATUS_ORDER.map((status) => (
                <option key={`status-opt-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            <div className="mb-1">Assignment</div>
            <select
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value as AssignedFilter)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-white"
            >
              <option value="ALL">ALL</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="UNASSIGNED">UNASSIGNED</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        {grouped.map((floorGroup) => (
          <article key={`floor-${floorGroup.floor}`} className="rounded border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-3 text-lg font-semibold text-cyan-100">{floorGroup.floor}</h2>
            <div className="space-y-3">
              {floorGroup.zones.map((zoneGroup) => (
                <div key={`zone-${floorGroup.floor}-${zoneGroup.zone}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-zinc-200">{zoneGroup.zone}</div>
                    <div className="text-xs text-zinc-400">{zoneGroup.rows.length} devices</div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {zoneGroup.rows.map((row) => (
                      <div key={`gw-card-${row.gateway_id}`} className="rounded border border-zinc-700 bg-zinc-900 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/ops/ble/gateways/${encodeURIComponent(row.gateway_id)}`}
                            className="font-mono text-xs text-cyan-200 underline underline-offset-2"
                          >
                            {row.gateway_id}
                          </Link>
                          <span className={statusBadgeClass(row.status)}>{row.status}</span>
                        </div>
                        <div className="mt-2 text-xs text-zinc-300">
                          <div>name: {normalizeText(row.display_name) || "-"}</div>
                          <div>type: {normalizeText(row.gateway_type) || "-"}</div>
                          <div>room_uuid: {normalizeText(row.room_uuid) || "-"}</div>
                          <div>
                            heartbeat: {formatDateTime(row.last_heartbeat_at)} ({formatRelativeSeconds(row.last_heartbeat_at)})
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!loading && grouped.length === 0 ? (
          <div className="rounded border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
            조건에 맞는 gateway가 없습니다.
          </div>
        ) : null}
      </section>
    </div>
  );
}

