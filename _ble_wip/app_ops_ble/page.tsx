"use client";

import Link from "next/link";
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

function SummaryCard({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
      : "border-zinc-700 bg-zinc-900 text-white";
  return (
    <div className={`rounded border p-3 ${toneClass}`}>
      <div className="text-xs text-zinc-400">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function OpsBlePage() {
  const [loadingGateways, setLoadingGateways] = useState(true);
  const [loadingPresence, setLoadingPresence] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateways, setGateways] = useState<BleGatewayRow[]>([]);
  const [presenceRows, setPresenceRows] = useState<BlePresenceRow[]>([]);
  const [eventRows, setEventRows] = useState<BleEventRow[]>([]);
  const [warningDrilldown, setWarningDrilldown] = useState<"none" | "hostess_null" | "room_null" | "stale_heartbeat">("none");
  const gatewaySigRef = useRef("");
  const presenceSigRef = useRef("");
  const eventSigRef = useRef("");

  const buildGatewaySig = (rows: BleGatewayRow[]) =>
    rows
      .map(
        (row) =>
          `${row.gateway_id}|${row.gateway_type}|${row.room_uuid ?? ""}|${row.last_heartbeat_at ?? ""}|${row.heartbeat_alive ? 1 : 0}|${row.is_active ? 1 : 0}`
      )
      .join("||");
  const buildPresenceSig = (rows: BlePresenceRow[]) =>
    rows
      .map(
        (row) =>
          `${row.hostess_uuid}|${row.gateway_id}|${row.beacon_minor}|${row.room_uuid ?? ""}|${row.last_seen_at}|${row.entered_at}`
      )
      .join("||");
  const buildEventSig = (rows: BleEventRow[]) =>
    rows
      .map(
        (row) =>
          `${row.id}|${row.gateway_id}|${row.event_type}|${row.observed_at}|${row.hostess_uuid ?? ""}|${row.room_uuid ?? ""}`
      )
      .join("||");

  const loadGateways = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoadingGateways(true);
      const gatewayRes = await fetch("/api/ops/ble/gateways", { credentials: "include", cache: "no-store" });
      const gatewayJson = await gatewayRes.json().catch(() => null);
      if (!gatewayRes.ok) throw new Error(String(gatewayJson?.error ?? `GATEWAYS_${gatewayRes.status}`));
      const nextGateways = Array.isArray(gatewayJson?.rows) ? (gatewayJson.rows as BleGatewayRow[]) : [];
      const nextGatewaySig = buildGatewaySig(nextGateways);
      if (gatewaySigRef.current !== nextGatewaySig) {
        gatewaySigRef.current = nextGatewaySig;
        setGateways(nextGateways);
      }
    } catch (e) {
      setGateways([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingGateways(false);
    }
  }, []);

  const loadPresence = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoadingPresence(true);
      const presenceRes = await fetch("/api/ops/ble/presence?active_only=true&limit=300", {
        credentials: "include",
        cache: "no-store",
      });
      const presenceJson = await presenceRes.json().catch(() => null);
      if (!presenceRes.ok) throw new Error(String(presenceJson?.error ?? `PRESENCE_${presenceRes.status}`));
      const nextPresence = Array.isArray(presenceJson?.rows) ? (presenceJson.rows as BlePresenceRow[]) : [];
      const nextPresenceSig = buildPresenceSig(nextPresence);
      if (presenceSigRef.current !== nextPresenceSig) {
        presenceSigRef.current = nextPresenceSig;
        setPresenceRows(nextPresence);
      }
    } catch (e) {
      setPresenceRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingPresence(false);
    }
  }, []);

  const loadEvents = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setLoadingEvents(true);
      const eventRes = await fetch("/api/ops/ble/events?limit=200", { credentials: "include", cache: "no-store" });
      const eventJson = await eventRes.json().catch(() => null);
      if (!eventRes.ok) throw new Error(String(eventJson?.error ?? `EVENTS_${eventRes.status}`));
      const nextEvents = Array.isArray(eventJson?.rows) ? (eventJson.rows as BleEventRow[]) : [];
      const nextEventSig = buildEventSig(nextEvents);
      if (eventSigRef.current !== nextEventSig) {
        eventSigRef.current = nextEventSig;
        setEventRows(nextEvents);
      }
    } catch (e) {
      setEventRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoadingEvents(false);
    }
  }, []);

  const reloadAll = useCallback(() => {
    setError(null);
    void Promise.all([loadGateways(), loadPresence(), loadEvents()]);
  }, [loadGateways, loadPresence, loadEvents]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadGateways({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadGateways]);

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
    const totalGateways = gateways.length;
    const aliveGateways = gateways.filter((row) => classifyGatewayHeartbeat(row.last_heartbeat_at) === "ALIVE").length;
    const staleGateways = gateways.filter((row) => classifyGatewayHeartbeat(row.last_heartbeat_at) === "STALE").length;
    const offlineGateways = gateways.filter((row) => classifyGatewayHeartbeat(row.last_heartbeat_at) === "OFFLINE").length;
    const activePresentCount = presenceRows.length;
    const nullHostessEvents = eventRows.filter((row) => !String(row.hostess_uuid ?? "").trim()).length;
    const nullRoomEvents = eventRows.filter((row) => !String(row.room_uuid ?? "").trim()).length;
    const staleHeartbeatWarnings = staleGateways + offlineGateways;
    const recentWarningsCount = nullHostessEvents + nullRoomEvents + staleHeartbeatWarnings;
    return {
      totalGateways,
      aliveGateways,
      staleGateways,
      offlineGateways,
      staleHeartbeatWarnings,
      activePresentCount,
      nullHostessEvents,
      nullRoomEvents,
      recentWarningsCount,
    };
  }, [gateways, presenceRows, eventRows]);

  const roomPresenceRows = useMemo(() => {
    const grouped = new Map<
      string,
      Array<{ hostess_uuid: string; alias_name: string | null; real_name: string | null; gateway_id: string }>
    >();
    for (const row of presenceRows) {
      const roomKey = String(row.room_uuid ?? "").trim() || "(null)";
      if (!grouped.has(roomKey)) grouped.set(roomKey, []);
      grouped.get(roomKey)!.push({
        hostess_uuid: row.hostess_uuid,
        alias_name: row.alias_name,
        real_name: row.real_name,
        gateway_id: row.gateway_id,
      });
    }
    return Array.from(grouped.entries())
      .map(([room_uuid, hostesses]) => ({
        room_uuid,
        hostesses,
      }))
      .sort((a, b) => a.room_uuid.localeCompare(b.room_uuid, "ko"));
  }, [presenceRows]);

  const filteredEvents = useMemo(() => {
    if (warningDrilldown === "hostess_null") {
      return eventRows.filter((row) => !String(row.hostess_uuid ?? "").trim());
    }
    if (warningDrilldown === "room_null") {
      return eventRows.filter((row) => !String(row.room_uuid ?? "").trim());
    }
    return eventRows;
  }, [eventRows, warningDrilldown]);

  const filteredGateways = useMemo(() => {
    if (warningDrilldown !== "stale_heartbeat") return gateways;
    return gateways.filter((row) => classifyGatewayHeartbeat(row.last_heartbeat_at) !== "ALIVE");
  }, [gateways, warningDrilldown]);

  const loading = loadingGateways || loadingPresence || loadingEvents;

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">OPS BLE Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-400">
              BLE gateway / presence / ingest events (read-only)
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reloadAll();
            }}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
          >
            새로고침
          </button>
          <Link
            href="/ops/ble/gateways"
            className="rounded bg-cyan-600 px-3 py-1.5 text-xs text-cyan-50 hover:bg-cyan-500"
          >
            Gateway 관리
          </Link>
        </div>
        {error ? (
          <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            오류: {error}
          </div>
        ) : null}
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard title="total gateways" value={`${summary.totalGateways}`} />
        <SummaryCard title="active present count" value={`${summary.activePresentCount}`} />
        <SummaryCard title="alive gateways count" value={`${summary.aliveGateways}`} tone="default" />
        <SummaryCard
          title="recent warnings count"
          value={`${summary.recentWarningsCount}`}
          tone={summary.recentWarningsCount > 0 ? "warn" : "default"}
        />
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">Gateway Status</h2>
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
            alive: {summary.aliveGateways}
          </span>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
            stale: {summary.staleGateways}
          </span>
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-200">
            offline: {summary.offlineGateways}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">gateway_id</th>
                <th className="p-2 text-left">type</th>
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">active</th>
                <th className="p-2 text-left">last heartbeat</th>
                <th className="p-2 text-left">status</th>
              </tr>
            </thead>
            <tbody>
              {filteredGateways.map((row) => {
                const status = classifyGatewayHeartbeat(row.last_heartbeat_at);
                const ageSec = heartbeatAgeSec(row.last_heartbeat_at);
                return (
                <tr key={`gateway-${row.gateway_id}`} className="border-t border-zinc-800">
                  <td className="p-2 font-mono text-xs">
                    <Link href={`/ops/ble/gateway/${encodeURIComponent(row.gateway_id)}`} className="text-cyan-200 underline underline-offset-2">
                      {row.gateway_id}
                    </Link>
                  </td>
                  <td className="p-2">{row.gateway_type}</td>
                  <td className="p-2 font-mono text-xs">{row.room_uuid ?? "-"}</td>
                  <td className="p-2">
                    {row.is_active ? (
                      <span className="text-emerald-300">true</span>
                    ) : (
                      <span className="text-zinc-400">false</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-zinc-300">
                    {formatDateTime(row.last_heartbeat_at)} ({formatRelativeSeconds(row.last_heartbeat_at)}
                    {ageSec != null ? ` / ${ageSec}s` : ""})
                  </td>
                  <td className="p-2">
                    <span className={gatewayStatusBadge(status)}>{status}</span>
                  </td>
                </tr>
              )})}
              {!loading && filteredGateways.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={6}>
                    표시할 gateway 데이터가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Warning Drill-down</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWarningDrilldown("none")}
            className={`rounded border px-2 py-1 text-xs ${warningDrilldown === "none" ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100" : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setWarningDrilldown("hostess_null")}
            className={`rounded border px-2 py-1 text-xs ${warningDrilldown === "hostess_null" ? "border-amber-400/40 bg-amber-500/15 text-amber-100" : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}
          >
            hostess_uuid null ({summary.nullHostessEvents})
          </button>
          <button
            type="button"
            onClick={() => setWarningDrilldown("room_null")}
            className={`rounded border px-2 py-1 text-xs ${warningDrilldown === "room_null" ? "border-amber-400/40 bg-amber-500/15 text-amber-100" : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}
          >
            room_uuid null ({summary.nullRoomEvents})
          </button>
          <button
            type="button"
            onClick={() => setWarningDrilldown("stale_heartbeat")}
            className={`rounded border px-2 py-1 text-xs ${warningDrilldown === "stale_heartbeat" ? "border-amber-400/40 bg-amber-500/15 text-amber-100" : "border-zinc-600 bg-zinc-800 text-zinc-300"}`}
          >
            stale heartbeat ({summary.staleHeartbeatWarnings})
          </button>
        </div>
      </section>

      <section className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Room Presence View</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">hostess count</th>
                <th className="p-2 text-left">hostess list</th>
              </tr>
            </thead>
            <tbody>
              {roomPresenceRows.map((row) => (
                <tr key={`room-presence-${row.room_uuid}`} className="border-t border-zinc-800">
                  <td className="p-2 font-mono text-xs">{row.room_uuid}</td>
                  <td className="p-2">{row.hostesses.length}</td>
                  <td className="p-2 text-xs">
                    {row.hostesses
                      .map((h) => `${String(h.alias_name ?? "").trim() || String(h.real_name ?? "").trim() || h.hostess_uuid} (${h.gateway_id})`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
              {!loading && roomPresenceRows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={3}>
                    표시할 room presence 데이터가 없습니다.
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
                <th className="p-2 text-left">gateway_id</th>
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">entered_at</th>
                <th className="p-2 text-left">last_seen_at</th>
              </tr>
            </thead>
            <tbody>
              {presenceRows.map((row, idx) => {
                const name = String(row.alias_name ?? "").trim() || String(row.real_name ?? "").trim() || "-";
                return (
                  <tr key={`presence-${row.hostess_uuid}-${row.gateway_id}-${idx}`} className="border-t border-zinc-800">
                    <td className="p-2">{name}</td>
                    <td className="p-2 font-mono">{row.beacon_minor}</td>
                    <td className="p-2 font-mono text-xs">{row.gateway_id}</td>
                    <td className="p-2 font-mono text-xs">{row.room_uuid ?? "-"}</td>
                    <td className="p-2 text-xs">{formatDateTime(row.entered_at)}</td>
                    <td className="p-2 text-xs">{formatDateTime(row.last_seen_at)}</td>
                  </tr>
                );
              })}
              {!loading && presenceRows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={6}>
                    현재 active presence가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">Recent Events</h2>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
            hostess_uuid null: {summary.nullHostessEvents}
          </span>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
            room_uuid null: {summary.nullRoomEvents}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">observed_at</th>
                <th className="p-2 text-left">event_type</th>
                <th className="p-2 text-left">gateway_id</th>
                <th className="p-2 text-left">beacon_minor</th>
                <th className="p-2 text-left">hostess_uuid</th>
                <th className="p-2 text-left">room_uuid</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((row) => (
                <tr key={`event-${row.id}`} className="border-t border-zinc-800">
                  <td className="p-2 text-xs">{formatDateTime(row.observed_at)}</td>
                  <td className="p-2">
                    <span className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs">
                      {row.event_type}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{row.gateway_id}</td>
                  <td className="p-2 font-mono">{row.beacon_minor}</td>
                  <td className="p-2 font-mono text-xs">
                    {row.hostess_uuid ? row.hostess_uuid : <span className="text-amber-300">null</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {row.room_uuid ? row.room_uuid : <span className="text-amber-300">null</span>}
                  </td>
                </tr>
              ))}
              {!loading && filteredEvents.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={6}>
                    최근 이벤트가 없습니다.
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

