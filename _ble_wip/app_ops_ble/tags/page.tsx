"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ApprovedGate from "@/components/auth/ApprovedGate";
import {
  formatMonitorDateTime,
  formatRelativeTime,
} from "@/lib/ops/ble/monitorPresentation";
import type {
  BleAssignablePerson,
  BleDeviceRegistryRow,
  BleDevicesResponse,
} from "@/lib/ops/ble/deviceRegistryTypes";

type DeviceMutationResponse = {
  ok?: boolean;
  row?: { id?: string | null };
  error?: string;
  message?: string;
};

function presenceClassName(status: BleDeviceRegistryRow["presence_status"]): string {
  if (status === "active") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100";
  if (status === "stale") return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  return "border-slate-700 bg-slate-900/80 text-slate-300";
}

function activeClassName(isActive: boolean): string {
  return isActive
    ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-100"
    : "border-zinc-700 bg-zinc-900/80 text-zinc-300";
}

function buildRoomLabel(row: BleDeviceRegistryRow): string {
  if (typeof row.room_name === "string" && row.room_name.trim() !== "") return row.room_name.trim();
  if (Number.isFinite(Number(row.room_no ?? NaN)) && Number(row.room_no) > 0) {
    return `${Math.trunc(Number(row.room_no))}번방`;
  }
  return "미확인 룸";
}

function getAssignedHostessLabel(row: BleDeviceRegistryRow): string | null {
  if (typeof row.assigned_person_name === "string" && row.assigned_person_name.trim() !== "") {
    return row.assigned_person_name.trim();
  }
  if (typeof row.assignment?.person_label === "string" && row.assignment.person_label.trim() !== "") {
    return row.assignment.person_label.trim();
  }
  return null;
}

export default function OpsBleTagsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BleDeviceRegistryRow[]>([]);
  const [people, setPeople] = useState<BleAssignablePerson[]>([]);
  const [filterText, setFilterText] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<BleDeviceRegistryRow | null>(null);
  const [deviceUidInput, setDeviceUidInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [isActiveInput, setIsActiveInput] = useState(true);
  const [hostessSearch, setHostessSearch] = useState("");
  const [selectedHostessId, setSelectedHostessId] = useState("");

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/ops/ble/devices", {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as BleDevicesResponse | null;
      if (!res.ok) {
        throw new Error(String(json?.message ?? json?.error ?? `devices ${res.status}`));
      }
      setRows(Array.isArray(json?.rows) ? json.rows : []);
      setPeople(Array.isArray(json?.people) ? json.people : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const hostessOptions = useMemo(() => {
    return people
      .filter((person) => person.source === "hostess" && person.is_active)
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));
  }, [people]);

  const filteredHostesses = useMemo(() => {
    const query = hostessSearch.trim().toLowerCase();
    if (!query) return hostessOptions;
    return hostessOptions.filter((person) => person.label.toLowerCase().includes(query));
  }, [hostessOptions, hostessSearch]);

  const filteredRows = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.device_uid,
        row.label ?? "",
        row.assigned_person_name ?? "",
        row.assignment?.person_label ?? "",
        row.last_seen_gateway_id ?? "",
        row.room_uuid ?? "",
        row.room_name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filterText, rows]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingRow(null);
    setDeviceUidInput("");
    setLabelInput("");
    setIsActiveInput(true);
    setHostessSearch("");
    setSelectedHostessId("");
    setModalOpen(true);
  };

  const openEditModal = (row: BleDeviceRegistryRow) => {
    setModalMode("edit");
    setEditingRow(row);
    setDeviceUidInput(row.device_uid);
    setLabelInput(row.label ?? "");
    setIsActiveInput(row.is_active !== false);
    setHostessSearch("");
    setSelectedHostessId(
      row.assigned_person_source === "hostess"
        ? row.assigned_person_id ?? ""
        : row.assignment?.source === "hostess"
          ? row.assignment.person_id
          : ""
    );
    setModalOpen(true);
  };

  const closeModal = () => {
    if (busyKey === "save-tag") return;
    setModalOpen(false);
  };

  const saveModal = useCallback(async () => {
    try {
      setBusyKey("save-tag");
      setError(null);
      let deviceId = editingRow?.id ?? null;
      const trimmedDeviceUid = deviceUidInput.trim();
      const trimmedLabel = labelInput.trim();

      if (modalMode === "create") {
        if (!trimmedDeviceUid) throw new Error("TAG_MINOR_REQUIRED");
        const createRes = await fetch("/api/ops/ble/devices", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_uid: trimmedDeviceUid,
            label: trimmedLabel || null,
          }),
        });
        const createJson = (await createRes.json().catch(() => null)) as DeviceMutationResponse | null;
        if (!createRes.ok) {
          throw new Error(String(createJson?.message ?? createJson?.error ?? `create ${createRes.status}`));
        }
        deviceId = String(createJson?.row?.id ?? "").trim() || null;
        if (!deviceId) throw new Error("DEVICE_CREATE_RESPONSE_INVALID");
      }

      if (!deviceId) throw new Error("DEVICE_ID_REQUIRED");

      const patchRes = await fetch("/api/ops/ble/devices", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          label: trimmedLabel || null,
          is_active: isActiveInput,
        }),
      });
      const patchJson = (await patchRes.json().catch(() => null)) as DeviceMutationResponse | null;
      if (!patchRes.ok) {
        throw new Error(String(patchJson?.message ?? patchJson?.error ?? `patch ${patchRes.status}`));
      }

      const currentAssignedHostessId =
        editingRow?.assigned_person_source === "hostess"
          ? editingRow.assigned_person_id ?? ""
          : editingRow?.assignment?.source === "hostess"
            ? editingRow.assignment.person_id
            : "";
      if (selectedHostessId && selectedHostessId !== currentAssignedHostessId) {
        const assignRes = await fetch("/api/ops/ble/devices/assign", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
            person_id: selectedHostessId,
          }),
        });
        const assignJson = (await assignRes.json().catch(() => null)) as DeviceMutationResponse | null;
        if (!assignRes.ok) {
          throw new Error(String(assignJson?.message ?? assignJson?.error ?? `assign ${assignRes.status}`));
        }
      } else if (!selectedHostessId && editingRow?.assignment) {
        const releaseRes = await fetch("/api/ops/ble/devices/release", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
          }),
        });
        const releaseJson = (await releaseRes.json().catch(() => null)) as DeviceMutationResponse | null;
        if (!releaseRes.ok) {
          throw new Error(String(releaseJson?.message ?? releaseJson?.error ?? `release ${releaseRes.status}`));
        }
      }

      await loadAll();
      setModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyKey(null);
    }
  }, [deviceUidInput, editingRow, isActiveInput, labelInput, loadAll, modalMode, selectedHostessId]);

  return (
    <ApprovedGate allowedRoles={["admin", "store_owner", "manager", "counter", "ops"]}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_28%),linear-gradient(180deg,#020617,#030712_30%,#02050f_100%)] px-4 py-6 text-slate-100">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">FOXPRO3 OPS</div>
              <h1 className="mt-2 text-3xl font-semibold text-white">BLE 태그 레지스트리</h1>
              <p className="mt-2 text-sm text-slate-400">
                store scope 안에서 태그 minor, 활성 여부, 최근 seen, 최근 gateway, hostess 연결 상태를 운영자가 직접 관리합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAll()}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                새로고침
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25"
              >
                태그 등록
              </button>
              <Link
                href="/ops/ble/monitor"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-slate-900/80"
              >
                BLE 운영 모니터
              </Link>
            </div>
          </header>

          {error ? (
            <div className="rounded-3xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              BLE 태그 레지스트리 데이터를 처리하지 못했습니다: {error}
            </div>
          ) : null}

          <section className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">등록 태그 목록</h2>
                <p className="mt-1 text-sm text-slate-400">minor / label / 활성 여부 / 최근 seen / 최근 gateway / 연결 hostess</p>
              </div>
              <input
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="minor, label, hostess, gateway 검색"
                className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
              />
            </div>

            <div className="mt-4 space-y-3">
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {row.label?.trim() ? row.label.trim() : `태그 ${row.device_uid}`}
                          </span>
                          <span className="text-xs text-slate-500">minor {row.device_uid}</span>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${activeClassName(row.is_active)}`}>
                            {row.is_active ? "활성 사용" : "비활성"}
                          </span>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${presenceClassName(row.presence_status)}`}>
                            {row.presence_status_label}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400">
                          연결 hostess: {getAssignedHostessLabel(row) ?? "미연결"}
                        </div>
                        <div className="text-xs text-slate-500">
                          마지막 감지 {formatRelativeTime(row.last_seen_at)} · {formatMonitorDateTime(row.last_seen_at)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.last_seen_gateway_id ? `${row.last_seen_gateway_id} · ` : ""}
                          {buildRoomLabel(row)}
                          {row.room_uuid ? ` · ${row.room_uuid}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        수정
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
                  {loading ? "태그 목록을 불러오는 중입니다." : "표시할 등록 태그가 없습니다."}
                </div>
              )}
            </div>
          </section>
        </div>

        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-950 p-5 text-slate-100 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {modalMode === "create" ? "태그 등록" : "태그 수정"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    label, 활성 여부, hostess 연결을 한 번에 관리합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-900"
                >
                  닫기
                </button>
              </div>

              <div className="mt-5 grid gap-4">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">minor</div>
                  <input
                    value={deviceUidInput}
                    onChange={(event) => setDeviceUidInput(event.target.value)}
                    disabled={modalMode === "edit"}
                    placeholder="예: 19641"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">label</div>
                  <input
                    value={labelInput}
                    onChange={(event) => setLabelInput(event.target.value)}
                    placeholder="운영용 태그 라벨"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={isActiveInput}
                    onChange={(event) => setIsActiveInput(event.target.checked)}
                  />
                  태그 활성 상태로 유지
                </label>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-white">Hostess 연결</div>
                    {editingRow && getAssignedHostessLabel(editingRow) ? (
                      <div className="text-xs text-slate-400">
                        현재 연결: {getAssignedHostessLabel(editingRow)}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">현재 연결 없음</div>
                    )}
                  </div>

                  <input
                    value={hostessSearch}
                    onChange={(event) => setHostessSearch(event.target.value)}
                    placeholder="hostess 이름 검색"
                    className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                  />

                  <select
                    value={selectedHostessId}
                    onChange={(event) => setSelectedHostessId(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                  >
                    <option value="">연결 없음</option>
                    {filteredHostesses.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-900"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void saveModal()}
                  disabled={busyKey === "save-tag" || (modalMode === "create" && deviceUidInput.trim() === "")}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyKey === "save-tag" ? "저장 중..." : modalMode === "create" ? "등록" : "저장"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ApprovedGate>
  );
}
