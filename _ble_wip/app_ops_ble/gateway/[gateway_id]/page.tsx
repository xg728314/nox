"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BleGatewayRow = {
  gateway_id: string;
  gateway_type: string;
  display_name: string | null;
  room_uuid: string | null;
  store_uuid: string | null;
  is_active: boolean;
  last_heartbeat_at: string | null;
  heartbeat_alive: boolean;
};

type BlePresenceRow = {
  hostess_uuid: string;
  beacon_minor: number;
  gateway_id: string;
  room_uuid: string | null;
  alias_name: string | null;
  real_name: string | null;
  entered_at: string;
  last_seen_at: string;
};

type BleEventRow = {
  id: string;
  gateway_id: string;
  beacon_minor: number;
  event_type: string;
  observed_at: string;
  received_at: string;
  room_uuid: string | null;
  hostess_uuid: string | null;
  metadata: Record<string, unknown>;
};

type GatewayHeartbeatStatus = "ALIVE" | "STALE" | "OFFLINE";

function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleString("ko-KR", { hour12: false });
}

function formatRelativeSeconds(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
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

function heartbeatAgeSec(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(0, Math.trunc((Date.now() - ms) / 1000));
}

function classifyGatewayHeartbeat(value: string | null | undefined): GatewayHeartbeatStatus {
  const ageSec = heartbeatAgeSec(value);
  if (ageSec == null) return "OFFLINE";
  if (ageSec < 60) return "ALIVE";
  if (ageSec <= 180) return "STALE";
  return "OFFLINE";
}

function gatewayStatusBadge(status: GatewayHeartbeatStatus) {
  if (status === "ALIVE") {
    return "rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200";
  }
  if (status === "STALE") {
    return "rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200";
  }
  return "rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-200";
}

export default function OpsBleGatewayDetailPage() {
  const params = useParams<{ gateway_id?: string | string[] }>();
  const gatewayIdParam = params?.gateway_id;
  const gatewayId =
    Array.isArray(gatewayIdParam) ? String(gatewayIdParam[0] ?? "").trim() : String(gatewayIdParam ?? "").trim();

  const [loadingGateways, setLoadingGateways] = useState(true);
  const [loadingPresence, setLoadingPresence] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<BleGatewayRow | null>(null);
  const [presenceRows, setPresenceRows] = useState<BlePresenceRow[]>([]);
  const [eventRows, setEventRows] = useState<BleEventRow[]>([]);
  const presenceSigRef = useRef("");
  const eventSigRef = useRef("");

  const loadGateway = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!gatewayId) return;
    try {
      if (!silent) setLoadingGateways(true);
      const res = await fetch("/api/ops/ble/gateways", { credentials: "include", cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error ?? `GATEWAYS_${res.status}`));
      const rows = Array.isArray(json?.rows) ? (json.rows as BleGatewayRow[]) : [];
      const found = rows.find((row) => String(row.gateway_id ?? "").trim() === gatewayId) ?? null;
      setGateway(found);
    } catch (e) {
      setGateway(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingGateways(false);
    }
  }, [gatewayId]);

  const loadPresence = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!gatewayId) return;
    try {
      if (!silent) setLoadingPresence(true);
      const res = await fetch(
        `/api/ops/ble/presence?active_only=true&limit=300&gateway_id=${encodeURIComponent(gatewayId)}`,
        { credentials: "include", cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error ?? `PRESENCE_${res.status}`));
      const rows = Array.isArray(json?.rows) ? (json.rows as BlePresenceRow[]) : [];
      const signature = rows
        .map(
          (row) =>
            `${row.hostess_uuid}|${row.gateway_id}|${row.beacon_minor}|${row.room_uuid ?? ""}|${row.last_seen_at}|${row.entered_at}`
        )
        .join("||");
      if (presenceSigRef.current !== signature) {
        presenceSigRef.current = signature;
        setPresenceRows(rows);
      }
    } catch (e) {
      setPresenceRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingPresence(false);
    }
  }, [gatewayId]);

  const loadEvents = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!gatewayId) return;
    try {
      if (!silent) setLoadingEvents(true);
      const res = await fetch(`/api/ops/ble/events?limit=200&gateway_id=${encodeURIComponent(gatewayId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error ?? `EVENTS_${res.status}`));
      const rows = Array.isArray(json?.rows) ? (json.rows as BleEventRow[]) : [];
      const signature = rows
        .map((row) => `${row.id}|${row.gateway_id}|${row.event_type}|${row.observed_at}|${row.hostess_uuid ?? ""}|${row.room_uuid ?? ""}`)
        .join("||");
      if (eventSigRef.current !== signature) {
        eventSigRef.current = signature;
        setEventRows(rows);
      }
    } catch (e) {
      setEventRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingEvents(false);
    }
  }, [gatewayId]);

  const reloadAll = useCallback(() => {
    setError(null);
    void Promise.all([loadGateway(), loadPresence(), loadEvents()]);
  }, [loadGateway, loadPresence, loadEvents]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadGateway({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadGateway]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadPresence({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadPresence]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadEvents({ silent: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadEvents]);

  const summary = useMemo(() => {
    const status = classifyGatewayHeartbeat(gateway?.last_heartbeat_at ?? null);
    const nullHostessEvents = eventRows.filter((row) => !String(row.hostess_uuid ?? "").trim()).length;
    const nullRoomEvents = eventRows.filter((row) => !String(row.room_uuid ?? "").trim()).length;
    const roomPresenceMap = new Map<string, string[]>();
    for (const row of presenceRows) {
      const roomKey = String(row.room_uuid ?? "").trim() || "(null)";
      if (!roomPresenceMap.has(roomKey)) roomPresenceMap.set(roomKey, []);
      const displayName =
        String(row.alias_name ?? "").trim() || String(row.real_name ?? "").trim() || row.hostess_uuid;
      roomPresenceMap.get(roomKey)!.push(displayName);
    }
    return {
      status,
      activePresenceCount: presenceRows.length,
      nullHostessEvents,
      nullRoomEvents,
      roomPresenceRows: Array.from(roomPresenceMap.entries()).map(([room_uuid, hostesses]) => ({
        room_uuid,
        hostesses,
      })),
    };
  }, [gateway, presenceRows, eventRows]);

  const loading = loadingGateways || loadingPresence || loadingEvents;

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="mb-1 text-xs text-zinc-400">
              <Link href="/ops/ble" className="text-cyan-200 underline underline-offset-2">
                OPS BLE Dashboard
              </Link>
              {" / "}
              Gateway Detail
            </div>
            <h1 className="text-xl font-semibold font-mono">{gatewayId || "(gateway_id 없음)"}</h1>
          </div>
          <button
            type="button"
            onClick={() => reloadAll()}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
          >
            새로고침
          </button>
        </div>
        {error ? (
          <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            오류: {error}
          </div>
        ) : null}
        {gateway ? (
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-3">
            <div>type: {gateway.gateway_type}</div>
            <div>room_uuid: <span className="font-mono">{gateway.room_uuid ?? "-"}</span></div>
            <div>
              status: <span className={gatewayStatusBadge(summary.status)}>{summary.status}</span>
            </div>
          </div>
        ) : !loading ? (
          <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            gateway를 찾을 수 없습니다.
          </div>
        ) : null}
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">last heartbeat</div>
          <div className="mt-1 text-xs text-zinc-200">
            {formatDateTime(gateway?.last_heartbeat_at)} ({formatRelativeSeconds(gateway?.last_heartbeat_at)})
          </div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">active presence</div>
          <div className="mt-1 text-2xl font-semibold">{summary.activePresenceCount}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">hostess_uuid null events</div>
          <div className="mt-1 text-2xl font-semibold">{summary.nullHostessEvents}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">room_uuid null events</div>
          <div className="mt-1 text-2xl font-semibold">{summary.nullRoomEvents}</div>
        </div>
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Room Presence View</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">hostess list</th>
              </tr>
            </thead>
            <tbody>
              {summary.roomPresenceRows.map((row) => (
                <tr key={`room-presence-${row.room_uuid}`} className="border-t border-zinc-800">
                  <td className="p-2 font-mono text-xs">{row.room_uuid}</td>
                  <td className="p-2 text-xs">{row.hostesses.join(", ")}</td>
                </tr>
              ))}
              {!loading && summary.roomPresenceRows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={2}>
                    room presence 데이터가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Active Presence</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">hostess name</th>
                <th className="p-2 text-left">beacon_minor</th>
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">entered_at</th>
                <th className="p-2 text-left">last_seen_at</th>
              </tr>
            </thead>
            <tbody>
              {presenceRows.map((row, idx) => {
                const name = String(row.alias_name ?? "").trim() || String(row.real_name ?? "").trim() || row.hostess_uuid;
                return (
                  <tr key={`presence-${row.hostess_uuid}-${idx}`} className="border-t border-zinc-800">
                    <td className="p-2">{name}</td>
                    <td className="p-2 font-mono">{row.beacon_minor}</td>
                    <td className="p-2 font-mono text-xs">{row.room_uuid ?? "-"}</td>
                    <td className="p-2 text-xs">{formatDateTime(row.entered_at)}</td>
                    <td className="p-2 text-xs">{formatDateTime(row.last_seen_at)}</td>
                  </tr>
                );
              })}
              {!loading && presenceRows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={5}>
                    active presence 데이터가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Recent Events</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">observed_at</th>
                <th className="p-2 text-left">event_type</th>
                <th className="p-2 text-left">beacon_minor</th>
                <th className="p-2 text-left">hostess_uuid</th>
                <th className="p-2 text-left">room_uuid</th>
              </tr>
            </thead>
            <tbody>
              {eventRows.map((row) => (
                <tr key={`event-${row.id}`} className="border-t border-zinc-800">
                  <td className="p-2 text-xs">{formatDateTime(row.observed_at)}</td>
                  <td className="p-2">{row.event_type}</td>
                  <td className="p-2 font-mono">{row.beacon_minor}</td>
                  <td className="p-2 font-mono text-xs">
                    {row.hostess_uuid ? row.hostess_uuid : <span className="text-amber-300">null</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {row.room_uuid ? row.room_uuid : <span className="text-amber-300">null</span>}
                  </td>
                </tr>
              ))}
              {!loading && eventRows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={5}>
                    이벤트 데이터가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

