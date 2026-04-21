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
  heartbeat_alive?: boolean;
};

type GatewayStatus = "UNASSIGNED" | "DISABLED" | "ALIVE" | "STALE" | "OFFLINE";

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

function classifyStatus(row: Pick<GatewayRow, "room_uuid" | "is_active" | "last_heartbeat_at">): GatewayStatus {
  const roomUuid = String(row.room_uuid ?? "").trim();
  if (!roomUuid) return "UNASSIGNED";
  if (!row.is_active) return "DISABLED";
  const lastHeartbeatAt = row.last_heartbeat_at;
  const raw = String(lastHeartbeatAt ?? "").trim();
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

export default function OpsBleGatewaysPage() {
  const [rows, setRows] = useState<GatewayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok || !json) {
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

  const summary = useMemo(() => {
    const unassigned = rows.filter((row) => classifyStatus(row) === "UNASSIGNED").length;
    const disabled = rows.filter((row) => classifyStatus(row) === "DISABLED").length;
    const alive = rows.filter((row) => classifyStatus(row) === "ALIVE").length;
    const stale = rows.filter((row) => classifyStatus(row) === "STALE").length;
    const offline = rows.filter((row) => classifyStatus(row) === "OFFLINE").length;
    const enabled = rows.filter((row) => row.is_active).length;
    return { unassigned, disabled, alive, stale, offline, enabled };
  }, [rows]);

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-zinc-400">
              <Link href="/ops/ble" className="text-cyan-200 underline underline-offset-2">
                OPS BLE Dashboard
              </Link>
              {" / Gateway Management"}
            </div>
            <h1 className="mt-1 text-xl font-semibold">BLE Gateways</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void loadRows();
              }}
              className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
            >
              새로고침
            </button>
            <Link
              href="/ops/ble/gateways/map"
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-indigo-50 hover:bg-indigo-500"
            >
              설치 맵
            </Link>
            <Link
              href="/ops/ble/gateways/new"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs text-cyan-50 hover:bg-cyan-500"
            >
              신규 등록
            </Link>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            오류: {error}
          </div>
        ) : null}
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">UNASSIGNED</div>
          <div className="mt-1 text-2xl font-semibold text-sky-200">{summary.unassigned}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">DISABLED</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-200">{summary.disabled}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">ALIVE</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-200">{summary.alive}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">STALE</div>
          <div className="mt-1 text-2xl font-semibold text-amber-200">{summary.stale}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">OFFLINE</div>
          <div className="mt-1 text-2xl font-semibold text-rose-200">{summary.offline}</div>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
          <div className="text-xs text-zinc-400">활성화된 게이트웨이</div>
          <div className="mt-1 text-2xl font-semibold">{summary.enabled}</div>
        </div>
      </section>

      <section className="rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th className="p-2 text-left">gateway_id</th>
                <th className="p-2 text-left">display_name</th>
                <th className="p-2 text-left">type</th>
                <th className="p-2 text-left">room_uuid</th>
                <th className="p-2 text-left">enabled</th>
                <th className="p-2 text-left">status</th>
                <th className="p-2 text-left">last_heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = classifyStatus(row);
                return (
                  <tr key={`gateway-row-${row.gateway_id}`} className="border-t border-zinc-800">
                    <td className="p-2 font-mono text-xs">
                      <Link
                        href={`/ops/ble/gateways/${encodeURIComponent(row.gateway_id)}`}
                        className="text-cyan-200 underline underline-offset-2"
                      >
                        {row.gateway_id}
                      </Link>
                    </td>
                    <td className="p-2">{row.display_name ?? "-"}</td>
                    <td className="p-2">{row.gateway_type}</td>
                    <td className="p-2 font-mono text-xs">{row.room_uuid ?? "-"}</td>
                    <td className="p-2">{row.is_active ? "true" : "false"}</td>
                    <td className="p-2">
                      <span className={statusBadgeClass(status)}>{status}</span>
                    </td>
                    <td className="p-2 text-xs text-zinc-300">
                      {formatDateTime(row.last_heartbeat_at)} ({formatRelativeSeconds(row.last_heartbeat_at)})
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={7}>
                    등록된 gateway가 없습니다.
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

