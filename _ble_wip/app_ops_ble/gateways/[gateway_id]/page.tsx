"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleString("ko-KR", { hour12: false });
}

export default function OpsBleGatewayDetailManagePage() {
  const router = useRouter();
  const params = useParams<{ gateway_id?: string | string[] }>();
  const gatewayIdParam = params?.gateway_id;
  const gatewayId =
    Array.isArray(gatewayIdParam) ? String(gatewayIdParam[0] ?? "").trim() : String(gatewayIdParam ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<GatewayRow | null>(null);
  const [gatewayType, setGatewayType] = useState("generic");
  const [displayName, setDisplayName] = useState("");
  const [roomUuid, setRoomUuid] = useState("");
  const [isActive, setIsActive] = useState(true);

  const loadGateway = useCallback(async (options?: { silent?: boolean }) => {
    if (!gatewayId) return;
    const silent = options?.silent === true;
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await fetch(`/api/ops/ble/gateways?gateway_id=${encodeURIComponent(gatewayId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(String(json?.error ?? `HTTP_${res.status}`));
      }
      const rows = Array.isArray(json?.rows) ? (json.rows as GatewayRow[]) : [];
      const found = rows.find((row) => String(row.gateway_id ?? "").trim() === gatewayId) ?? null;
      setGateway(found);
      setGatewayType(String(found?.gateway_type ?? "generic").trim() || "generic");
      setDisplayName(String(found?.display_name ?? "").trim());
      setRoomUuid(String(found?.room_uuid ?? "").trim());
      setIsActive(Boolean(found?.is_active));
    } catch (e) {
      setGateway(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [gatewayId]);

  useEffect(() => {
    void loadGateway();
  }, [loadGateway]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadGateway({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadGateway]);

  const status = useMemo(
    () => classifyStatus({ room_uuid: gateway?.room_uuid ?? null, is_active: Boolean(gateway?.is_active), last_heartbeat_at: gateway?.last_heartbeat_at ?? null }),
    [gateway?.room_uuid, gateway?.is_active, gateway?.last_heartbeat_at]
  );
  const statusCounts = useMemo(() => {
    return {
      unassigned: status === "UNASSIGNED" ? 1 : 0,
      disabled: status === "DISABLED" ? 1 : 0,
      alive: status === "ALIVE" ? 1 : 0,
      stale: status === "STALE" ? 1 : 0,
      offline: status === "OFFLINE" ? 1 : 0,
    };
  }, [status]);

  const submitPatch = async (patch: Record<string, unknown>) => {
    if (!gatewayId) return;
    try {
      setSaving(true);
      setError(null);
      const res = await fetch("/api/ops/ble/gateways", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway_id: gatewayId,
          ...patch,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(String(json?.error ?? `HTTP_${res.status}`));
      }
      await loadGateway();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await submitPatch({
      gateway_type: gatewayType.trim() || "generic",
      display_name: displayName.trim() || null,
      room_uuid: roomUuid.trim() || null,
      is_active: isActive,
    });
  };

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400">
          <Link href="/ops/ble/gateways" className="text-cyan-200 underline underline-offset-2">
            BLE Gateways
          </Link>
          {" / 상세 관리"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold">{gatewayId || "(gateway_id 없음)"}</h1>
          <span className={statusBadgeClass(status)}>{status}</span>
        </div>
        <div className="mt-2 text-xs text-zinc-400">
          last heartbeat: {formatDateTime(gateway?.last_heartbeat_at)}
        </div>
        {error ? (
          <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            오류: {error}
          </div>
        ) : null}
      </header>

      {!loading && !gateway ? (
        <section className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          gateway를 찾을 수 없습니다.
          <div className="mt-2">
            <button
              type="button"
              onClick={() => router.push("/ops/ble/gateways")}
              className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
            >
              목록으로
            </button>
          </div>
        </section>
      ) : (
        <div className="max-w-2xl space-y-4">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="text-xs text-zinc-400">UNASSIGNED</div>
              <div className="mt-1 text-2xl font-semibold text-sky-200">{statusCounts.unassigned}</div>
            </div>
            <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="text-xs text-zinc-400">DISABLED</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-200">{statusCounts.disabled}</div>
            </div>
            <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="text-xs text-zinc-400">ALIVE</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-200">{statusCounts.alive}</div>
            </div>
            <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="text-xs text-zinc-400">STALE</div>
              <div className="mt-1 text-2xl font-semibold text-amber-200">{statusCounts.stale}</div>
            </div>
            <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
              <div className="text-xs text-zinc-400">OFFLINE</div>
              <div className="mt-1 text-2xl font-semibold text-rose-200">{statusCounts.offline}</div>
            </div>
          </section>
          <section className="rounded border border-zinc-700 bg-zinc-900 p-4">
          <form className="space-y-4" onSubmit={onSave}>
            <label className="block text-sm">
              <div className="mb-1 text-zinc-300">gateway_type</div>
              <input
                value={gatewayType}
                onChange={(e) => setGatewayType(e.target.value)}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white"
                disabled={saving}
              />
            </label>

            <label className="block text-sm">
              <div className="mb-1 text-zinc-300">display_name</div>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white"
                disabled={saving}
              />
            </label>

            <label className="block text-sm">
              <div className="mb-1 text-zinc-300">room_uuid (optional)</div>
              <input
                value={roomUuid}
                onChange={(e) => setRoomUuid(e.target.value)}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
                disabled={saving}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={saving}
              />
              활성화
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-cyan-600 px-3 py-2 text-sm text-cyan-50 hover:bg-cyan-500 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void submitPatch({ is_active: !isActive });
                }}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {isActive ? "비활성화" : "활성화"}
              </button>
              <Link
                href="/ops/ble/gateways"
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700"
              >
                목록으로
              </Link>
            </div>
          </form>
          </section>
        </div>
      )}
    </div>
  );
}

