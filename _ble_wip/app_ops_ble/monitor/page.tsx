"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ApprovedGate from "@/components/auth/ApprovedGate";
import BleAlertChips from "@/components/ops/ble/BleAlertChips";
import BleActiveTagsPanel from "@/components/ops/ble/BleActiveTagsPanel";
import BleCriticalBanner from "@/components/ops/ble/BleCriticalBanner";
import BleDeviceRegistryPanel from "@/components/ops/ble/BleDeviceRegistryPanel";
import BleGatewayHealthRow from "@/components/ops/ble/BleGatewayHealthRow";
import BleKpiCards from "@/components/ops/ble/BleKpiCards";
import BleRecentLogsCollapse from "@/components/ops/ble/BleRecentLogsCollapse";
import BleRoomGrid from "@/components/ops/ble/BleRoomGrid";
import BleUnknownDevicesPanel from "@/components/ops/ble/BleUnknownDevicesPanel";
import type {
  BleAssignablePerson,
  BleDevicesResponse,
  BleDeviceRegistryRow,
  BleUnknownDeviceRow,
  BleUnknownDevicesResponse,
} from "@/lib/ops/ble/deviceRegistryTypes";
import {
  BLE_MONITOR_POLL_MS,
  buildBleMonitorDashboard,
  formatMonitorDateTime,
  type BleMonitorSessionRow,
  type MonitorEventRow,
  type MonitorGatewayRow,
  type MonitorPresenceRoomProjection,
  type MonitorPresenceRow,
} from "@/lib/ops/ble/monitorPresentation";

type PresenceResponse = {
  ok?: boolean;
  rows?: MonitorPresenceRow[];
  rooms?: MonitorPresenceRoomProjection[];
  error?: string;
  message?: string;
};

type RowResponse<T> = {
  ok?: boolean;
  rows?: T[];
  error?: string;
  message?: string;
};

export default function OpsBleMonitorPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [gateways, setGateways] = useState<MonitorGatewayRow[]>([]);
  const [events, setEvents] = useState<MonitorEventRow[]>([]);
  const [presence, setPresence] = useState<MonitorPresenceRow[]>([]);
  const [presenceMonitorRows, setPresenceMonitorRows] = useState<MonitorPresenceRow[]>([]);
  const [presenceRooms, setPresenceRooms] = useState<MonitorPresenceRoomProjection[]>([]);
  const [sessions, setSessions] = useState<BleMonitorSessionRow[]>([]);
  const [devices, setDevices] = useState<BleDeviceRegistryRow[]>([]);
  const [unknownDevices, setUnknownDevices] = useState<BleUnknownDeviceRow[]>([]);
  const [assignablePeople, setAssignablePeople] = useState<BleAssignablePerson[]>([]);
  const [deviceBusyKey, setDeviceBusyKey] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const loadDevicePanels = useCallback(async () => {
    try {
      const [devicesRes, unknownRes] = await Promise.all([
        fetch("/api/ops/ble/devices", { credentials: "include", cache: "no-store" }),
        fetch("/api/ops/ble/devices/unknown", { credentials: "include", cache: "no-store" }),
      ]);

      const [devicesJson, unknownJson] = await Promise.all([
        devicesRes.json().catch(() => null) as Promise<BleDevicesResponse | null>,
        unknownRes.json().catch(() => null) as Promise<BleUnknownDevicesResponse | null>,
      ]);

      if (!devicesRes.ok) {
        throw new Error(
          String(devicesJson?.message ?? devicesJson?.error ?? `devices ${devicesRes.status}`)
        );
      }
      if (!unknownRes.ok) {
        throw new Error(
          String(unknownJson?.message ?? unknownJson?.error ?? `unknown ${unknownRes.status}`)
        );
      }

      setDevices(Array.isArray(devicesJson?.rows) ? devicesJson.rows : []);
      setAssignablePeople(Array.isArray(devicesJson?.people) ? devicesJson.people : []);
      setUnknownDevices(Array.isArray(unknownJson?.rows) ? unknownJson.rows : []);
      setDeviceError(null);
    } catch (loadError) {
      setDeviceError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  const loadAll = useCallback(async (silent: boolean) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const [gatewayRes, eventRes, presenceRes, presenceMonitorRes, sessionRes] = await Promise.all([
        fetch("/api/ops/ble/gateways", { credentials: "include", cache: "no-store" }),
        fetch("/api/ops/ble/events?limit=60", { credentials: "include", cache: "no-store" }),
        fetch("/api/ops/ble/presence?active_only=true&limit=300", { credentials: "include", cache: "no-store" }),
        fetch("/api/ops/ble/presence?active_only=false&limit=300", { credentials: "include", cache: "no-store" }),
        fetch("/api/ops/ble/monitor", { credentials: "include", cache: "no-store" }),
      ]);

      const [gatewayJson, eventJson, presenceJson, presenceMonitorJson, sessionJson] = await Promise.all([
        gatewayRes.json().catch(() => null) as Promise<RowResponse<MonitorGatewayRow> | null>,
        eventRes.json().catch(() => null) as Promise<RowResponse<MonitorEventRow> | null>,
        presenceRes.json().catch(() => null) as Promise<PresenceResponse | null>,
        presenceMonitorRes.json().catch(() => null) as Promise<PresenceResponse | null>,
        sessionRes.json().catch(() => null) as Promise<RowResponse<BleMonitorSessionRow> | null>,
      ]);

      if (!gatewayRes.ok) throw new Error(String(gatewayJson?.message ?? gatewayJson?.error ?? `gateways ${gatewayRes.status}`));
      if (!eventRes.ok) throw new Error(String(eventJson?.message ?? eventJson?.error ?? `events ${eventRes.status}`));
      if (!presenceRes.ok) throw new Error(String(presenceJson?.message ?? presenceJson?.error ?? `presence ${presenceRes.status}`));
      if (!presenceMonitorRes.ok) {
        throw new Error(
          String(presenceMonitorJson?.message ?? presenceMonitorJson?.error ?? `presence-monitor ${presenceMonitorRes.status}`)
        );
      }
      if (!sessionRes.ok) throw new Error(String(sessionJson?.message ?? sessionJson?.error ?? `monitor ${sessionRes.status}`));

      setGateways(Array.isArray(gatewayJson?.rows) ? gatewayJson.rows : []);
      setEvents(
        (Array.isArray(eventJson?.rows) ? eventJson.rows : []).map((row) => {
          const metadata =
            row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
              ? row.metadata
              : undefined;
          return { ...row, metadata };
        })
      );
      setPresence(Array.isArray(presenceJson?.rows) ? presenceJson.rows : []);
      setPresenceMonitorRows(Array.isArray(presenceMonitorJson?.rows) ? presenceMonitorJson.rows : []);
      setPresenceRooms(Array.isArray(presenceJson?.rooms) ? presenceJson.rooms : []);
      setSessions(Array.isArray(sessionJson?.rows) ? sessionJson.rows : []);
      setLastFetchAt(Date.now());
      await loadDevicePanels();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loadDevicePanels]);

  const handleRegisterAndAssignUnknownDevice = useCallback(
    async (args: { deviceUid: string; label: string | null; personId: string }) => {
      setDeviceBusyKey(`register:${args.deviceUid}`);
      setDeviceError(null);
      try {
        const registerRes = await fetch("/api/ops/ble/devices", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_uid: args.deviceUid,
            label: args.label,
          }),
        });
        const registerJson = (await registerRes.json().catch(() => null)) as
          | { ok?: boolean; row?: { id?: string | null }; error?: string; message?: string }
          | null;
        if (!registerRes.ok) {
          throw new Error(
            String(registerJson?.message ?? registerJson?.error ?? `register ${registerRes.status}`)
          );
        }
        const deviceId = String(registerJson?.row?.id ?? "").trim();
        if (!deviceId) throw new Error("DEVICE_REGISTER_RESPONSE_INVALID");

        const assignRes = await fetch("/api/ops/ble/devices/assign", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
            person_id: args.personId,
          }),
        });
        const assignJson = (await assignRes.json().catch(() => null)) as
          | { ok?: boolean; error?: string; message?: string }
          | null;
        if (!assignRes.ok) {
          throw new Error(
            String(assignJson?.message ?? assignJson?.error ?? `assign ${assignRes.status}`)
          );
        }

        await loadDevicePanels();
      } catch (actionError) {
        setDeviceError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setDeviceBusyKey(null);
      }
    },
    [loadDevicePanels]
  );

  const handleAssignDevice = useCallback(
    async (args: { deviceId: string; personId: string }) => {
      setDeviceBusyKey(`assign:${args.deviceId}`);
      setDeviceError(null);
      try {
        const res = await fetch("/api/ops/ble/devices/assign", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_id: args.deviceId,
            person_id: args.personId,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; message?: string }
          | null;
        if (!res.ok) {
          throw new Error(String(json?.message ?? json?.error ?? `assign ${res.status}`));
        }
        await loadDevicePanels();
      } catch (actionError) {
        setDeviceError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setDeviceBusyKey(null);
      }
    },
    [loadDevicePanels]
  );

  const handleReleaseDevice = useCallback(
    async (args: { deviceId: string }) => {
      setDeviceBusyKey(`release:${args.deviceId}`);
      setDeviceError(null);
      try {
        const res = await fetch("/api/ops/ble/devices/release", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_id: args.deviceId,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; message?: string }
          | null;
        if (!res.ok) {
          throw new Error(String(json?.message ?? json?.error ?? `release ${res.status}`));
        }
        await loadDevicePanels();
      } catch (actionError) {
        setDeviceError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setDeviceBusyKey(null);
      }
    },
    [loadDevicePanels]
  );

  useEffect(() => {
    void loadAll(false);
    const intervalId = window.setInterval(() => void loadAll(true), BLE_MONITOR_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadAll]);

  const dashboard = useMemo(
    () =>
      buildBleMonitorDashboard({
        gateways,
        events,
        presence,
        presenceRooms,
        sessions,
      }),
    [events, gateways, presence, presenceRooms, sessions]
  );

  const filteredRoomCards = useMemo(() => {
    return dashboard.roomCards;
  }, [dashboard.roomCards]);

  const lastUpdatedLabel = lastFetchAt ? formatMonitorDateTime(new Date(lastFetchAt).toISOString()) : "미수신";
  const hasData = gateways.length > 0 || events.length > 0 || presence.length > 0 || sessions.length > 0;

  return (
    <ApprovedGate allowedRoles={["admin", "store_owner", "manager", "counter", "ops"]}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_28%),linear-gradient(180deg,#020617,#030712_30%,#02050f_100%)] px-4 py-6 text-slate-100">
        <div className="mx-auto max-w-[1500px] space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">FOXPRO3 OPS</div>
              <h1 className="mt-2 text-3xl font-semibold text-white">BLE 운영 모니터</h1>
              <p className="mt-2 text-sm text-slate-400">
                운영 판단 우선 레이아웃으로 재구성된 BLE 상황판입니다. 룸 중심으로 보고, 게이트웨이/로그는 보조 정보로 낮춰서 배치했습니다.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                폴링 {BLE_MONITOR_POLL_MS / 1000}초 · 마지막 동기화 {lastUpdatedLabel}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAll(false)}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
              >
                새로고침
              </button>
              <Link
                href="/ops/ble"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-slate-900/80"
              >
                BLE 운영
              </Link>
              <Link
                href="/ops/ble/tags"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-slate-900/80"
              >
                태그 레지스트리
              </Link>
              <Link
                href="/ops"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900/80"
              >
                OPS
              </Link>
            </div>
          </header>

          {error ? (
            <div className="rounded-3xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              BLE 운영 모니터 데이터를 불러오지 못했습니다: {error}
            </div>
          ) : null}

          <BleCriticalBanner criticalTarget={dashboard.criticalTarget} lastUpdatedLabel={lastUpdatedLabel} />
          <BleKpiCards kpi={dashboard.kpi} />
          <BleAlertChips chips={dashboard.alertChips} />

          <section className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <h2 className="text-base font-semibold text-white">현장 검증 체크포인트</h2>
                <p className="mt-1 text-sm text-slate-400">
                  실제 방 배치 후에는 게이트웨이 온라인 -&gt; room 매핑 -&gt; active 감지 -&gt; takeover -&gt; stale -&gt;
                  RoomCard 경고 순서로 확인합니다.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  상세 체크리스트: `docs/ops/BLE_FIELD_TEST_CHECKLIST.md`
                </p>
              </div>
              <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  1. `gateway online` / `gateway-room mapping`
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  2. `stronger_rssi_takeover` / `weaker_recent_gateway`
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  3. `stale_takeover` / monitor `이탈 후보`
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  4. `/counter` badge 이동 / mismatch 경고 변화
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
              {[
                "[BLE_RSSI_COMPARE]",
                "[BLE_PRESENCE_DECISION]",
                "[BLE_MONITOR_STALE]",
                "[BLE_WARNING_PRIORITY]",
              ].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-100"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">룸 운영 카드</h2>
                <p className="mt-1 text-sm text-slate-400">위험도, 진행 시간, 참여자, 실장, 종료 예정 시각을 룸 카드에서 한 번에 확인합니다.</p>
              </div>
            </div>
            <BleRoomGrid rooms={filteredRoomCards} loading={loading} />
          </section>

          <BleActiveTagsPanel rows={presenceMonitorRows} />

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <BleUnknownDevicesPanel
              rows={unknownDevices}
              people={assignablePeople}
              busyDeviceUid={deviceBusyKey?.startsWith("register:") ? deviceBusyKey.slice("register:".length) : null}
              error={deviceError}
              onRegisterAndAssign={handleRegisterAndAssignUnknownDevice}
            />
            <BleDeviceRegistryPanel
              rows={devices}
              people={assignablePeople}
              busyDeviceKey={deviceBusyKey}
              error={deviceError}
              onAssign={handleAssignDevice}
              onRelease={handleReleaseDevice}
            />
          </section>

          <BleGatewayHealthRow gateways={dashboard.gatewayHealth} />
          <BleRecentLogsCollapse logs={dashboard.recentLogs} lastUpdatedLabel={lastUpdatedLabel} />

          {!loading && !hasData ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-950/55 px-5 py-10 text-center">
              <h2 className="text-lg font-medium text-white">현재 표시할 BLE 데이터가 없습니다.</h2>
              <p className="mt-2 text-sm text-slate-400">게이트웨이 heartbeat, ingest 이벤트, room presence가 들어오면 상황판이 자동으로 채워집니다.</p>
            </section>
          ) : null}
        </div>
      </div>
    </ApprovedGate>
  );
}
