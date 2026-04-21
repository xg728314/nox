"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OpsBleGatewayNewPage() {
  const router = useRouter();
  const [gatewayId, setGatewayId] = useState("");
  const [gatewayType, setGatewayType] = useState("generic");
  const [displayName, setDisplayName] = useState("");
  const [roomUuid, setRoomUuid] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedGatewayId = gatewayId.trim();
    if (!normalizedGatewayId) {
      setError("gateway_id를 입력하세요.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch("/api/ops/ble/gateways", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway_id: normalizedGatewayId,
          gateway_type: gatewayType.trim() || "generic",
          display_name: displayName.trim() || null,
          room_uuid: roomUuid.trim() || null,
          is_active: isActive,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(String(json?.error ?? `HTTP_${res.status}`));
      }
      router.push(`/ops/ble/gateways/${encodeURIComponent(normalizedGatewayId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black px-6 py-6 text-white">
      <header className="mb-4 rounded border border-zinc-700 bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400">
          <Link href="/ops/ble/gateways" className="text-cyan-200 underline underline-offset-2">
            BLE Gateways
          </Link>
          {" / 신규 등록"}
        </div>
        <h1 className="mt-1 text-xl font-semibold">Gateway Registration</h1>
      </header>

      <section className="max-w-2xl rounded border border-zinc-700 bg-zinc-900 p-4">
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            <div className="mb-1 text-zinc-300">gateway_id *</div>
            <input
              value={gatewayId}
              onChange={(e) => setGatewayId(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
              placeholder="gw-001"
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <div className="mb-1 text-zinc-300">gateway_type</div>
            <input
              value={gatewayType}
              onChange={(e) => setGatewayType(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white"
              placeholder="generic"
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <div className="mb-1 text-zinc-300">display_name</div>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-white"
              placeholder="입구 게이트웨이"
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <div className="mb-1 text-zinc-300">room_uuid (optional)</div>
            <input
              value={roomUuid}
              onChange={(e) => setRoomUuid(e.target.value)}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
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
            활성화 상태로 등록
          </label>

          {error ? (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              오류: {error}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-cyan-600 px-3 py-2 text-sm text-cyan-50 hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? "등록 중..." : "등록"}
            </button>
            <Link
              href="/ops/ble/gateways"
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              취소
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}

