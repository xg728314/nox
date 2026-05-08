"use client"

/**
 * /owner/ble — BLE 게이트웨이 + 태그 통합 관리.
 *
 * 점주가 알리바바 게이트웨이 / 태그를 받자마자 직접 등록 가능.
 *
 * 탭 구조:
 *   1. 게이트웨이 (gateway_id, 방 매핑, secret 발급/재발급, 활성 토글, 삭제)
 *   2. 태그 (minor, 라벨, 직원 매핑, 활성 토글, 삭제)
 *
 * 권한: owner only (서버에서도 가드).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Gateway = {
  id: string
  gateway_id: string
  room_uuid: string | null
  room_label: string | null
  display_name: string | null
  gateway_type: string
  is_active: boolean
  secret_preview: string
  last_seen_at: string | null
  is_online: boolean
  created_at: string
}

type Tag = {
  id: string
  minor: number
  membership_id: string | null
  member_name: string | null
  member_role: string | null
  tag_label: string | null
  is_active: boolean
  last_seen_at: string | null
  last_event_type: string | null
  is_online: boolean
  created_at: string
}

type Room = { id: string; room_no: string; room_name: string | null }
type StaffMember = { membership_id: string; name: string; role: string }

type Discovered = {
  minor: number
  first_seen_at: string
  last_seen_at: string
  detect_count: number
  avg_rssi: number | null
  last_gateway_id: string
  last_gateway_label: string | null
  last_room_label: string | null
}

export default function BleManagementPage() {
  const router = useRouter()
  const [tab, setTab] = useState<"gateway" | "tag">("gateway")
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [discovered, setDiscovered] = useState<Discovered[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0)

  // 게이트웨이 등록 form
  const [gwOpen, setGwOpen] = useState(false)
  const [gwId, setGwId] = useState("")
  const [gwName, setGwName] = useState("")
  const [gwRoomUuid, setGwRoomUuid] = useState("")
  const [gwType, setGwType] = useState<"room" | "common" | "entrance">("room")
  const [gwSubmitting, setGwSubmitting] = useState(false)
  const [gwResult, setGwResult] = useState<{ secret: string; gatewayId: string } | null>(null)

  // 태그 등록 form
  const [tagOpen, setTagOpen] = useState(false)
  const [tagMinor, setTagMinor] = useState("")
  const [tagLabel, setTagLabel] = useState("")
  const [tagMember, setTagMember] = useState("")
  const [tagSubmitting, setTagSubmitting] = useState(false)

  useEffect(() => {
    void loadAll()
  }, [])

  // 태그 탭 진입 시 + 5초마다 자동 감지 polling.
  useEffect(() => {
    if (tab !== "tag") return
    void loadDiscovered()
    const t = setInterval(() => loadDiscovered(), 5000)
    return () => clearInterval(t)
  }, [tab, discoveryRefresh])

  async function loadAll() {
    setLoading(true)
    setError("")
    try {
      const [gwRes, tagRes, roomsRes, staffRes] = await Promise.all([
        apiFetch("/api/ble/gateways"),
        apiFetch("/api/ble/tags"),
        apiFetch("/api/rooms"),
        apiFetch("/api/store/staff"),
      ])
      if (gwRes.status === 401 || gwRes.status === 403) {
        router.push("/login")
        return
      }
      const [gwData, tagData, roomData, staffData] = await Promise.all([
        gwRes.json().catch(() => ({})),
        tagRes.json().catch(() => ({})),
        roomsRes.json().catch(() => ({})),
        staffRes.json().catch(() => ({})),
      ])
      setGateways(gwData?.gateways ?? [])
      setTags(tagData?.tags ?? [])
      setRooms(
        ((roomData?.rooms ?? []) as Array<{ id: string; room_no: string; room_name: string | null }>).map(
          (r) => ({ id: r.id, room_no: r.room_no, room_name: r.room_name }),
        ),
      )
      setStaff(
        ((staffData?.staff ?? []) as Array<{ membership_id: string; name: string; role: string }>).filter(
          (s) => s.membership_id && s.name,
        ),
      )
    } catch {
      setError("데이터 조회 실패")
    } finally {
      setLoading(false)
    }
  }

  async function loadDiscovered() {
    try {
      const res = await apiFetch("/api/ble/tags/discovered")
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setDiscovered(data?.discovered ?? [])
    } catch {
      /* swallow — polling */
    }
  }

  async function handleQuickRegister(d: Discovered, membershipId: string) {
    setError("")
    try {
      const res = await apiFetch("/api/ble/tags", {
        method: "POST",
        body: JSON.stringify({
          minor: d.minor,
          membership_id: membershipId || null,
          tag_label: null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || "등록 실패")
        return
      }
      setDiscoveryRefresh((v) => v + 1)
      void loadAll()
    } catch {
      setError("네트워크 오류")
    }
  }

  async function handleGwSubmit() {
    setError("")
    setGwSubmitting(true)
    try {
      const res = await apiFetch("/api/ble/gateways", {
        method: "POST",
        body: JSON.stringify({
          gateway_id: gwId,
          display_name: gwName || null,
          room_uuid: gwRoomUuid || null,
          gateway_type: gwType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || "등록 실패")
        return
      }
      setGwResult({
        secret: data.gateway.gateway_secret,
        gatewayId: data.gateway.gateway_id,
      })
      setGwId("")
      setGwName("")
      setGwRoomUuid("")
      setGwType("room")
      void loadAll()
    } catch {
      setError("네트워크 오류")
    } finally {
      setGwSubmitting(false)
    }
  }

  async function handleGwDelete(id: string, label: string) {
    if (!confirm(`게이트웨이 "${label}" 를 삭제하시겠습니까?`)) return
    const res = await apiFetch(`/api/ble/gateways/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d?.message || "삭제 실패")
      return
    }
    void loadAll()
  }

  async function handleGwToggleActive(g: Gateway) {
    const res = await apiFetch(`/api/ble/gateways/${g.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !g.is_active }),
    })
    if (res.ok) void loadAll()
  }

  async function handleGwRegenerate(g: Gateway) {
    if (!confirm(
      `게이트웨이 "${g.gateway_id}" 의 secret 을 재발급하시겠습니까?\n` +
      "기존 secret 으로 인증하던 게이트웨이는 즉시 ingest 실패합니다.",
    )) return
    const res = await apiFetch(`/api/ble/gateways/${g.id}/regenerate-secret`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data?.message || "재발급 실패")
      return
    }
    setGwResult({ secret: data.gateway_secret, gatewayId: data.gateway_id })
    void loadAll()
  }

  async function handleTagSubmit() {
    setError("")
    const minor = Number(tagMinor)
    if (!Number.isInteger(minor) || minor < 1 || minor > 65535) {
      setError("minor 는 1-65535 정수여야 합니다.")
      return
    }
    setTagSubmitting(true)
    try {
      const res = await apiFetch("/api/ble/tags", {
        method: "POST",
        body: JSON.stringify({
          minor,
          tag_label: tagLabel || null,
          membership_id: tagMember || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || "등록 실패")
        return
      }
      setTagMinor("")
      setTagLabel("")
      setTagMember("")
      setTagOpen(false)
      void loadAll()
    } catch {
      setError("네트워크 오류")
    } finally {
      setTagSubmitting(false)
    }
  }

  async function handleTagDelete(t: Tag) {
    if (!confirm(`태그 minor=${t.minor} 를 삭제하시겠습니까?`)) return
    const res = await apiFetch(`/api/ble/tags/${t.id}`, { method: "DELETE" })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d?.message || "삭제 실패")
      return
    }
    void loadAll()
  }

  async function handleTagAssignMember(t: Tag, membershipId: string) {
    const res = await apiFetch(`/api/ble/tags/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ membership_id: membershipId || null }),
    })
    if (res.ok) void loadAll()
    else {
      const d = await res.json().catch(() => ({}))
      alert(d?.message || "수정 실패")
    }
  }

  async function handleTagToggleActive(t: Tag) {
    const res = await apiFetch(`/api/ble/tags/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !t.is_active }),
    })
    if (res.ok) void loadAll()
  }

  function lastSeenLabel(iso: string | null) {
    if (!iso) return "—"
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return `${diff}초 전`
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
    return `${Math.floor(diff / 86400)}일 전`
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">
            ← 사장
          </button>
          <span className="font-semibold">BLE 관리</span>
          <div className="w-12" />
        </div>

        {/* 탭 */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab("gateway")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === "gateway" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-500"
            }`}
          >
            게이트웨이 ({gateways.length})
          </button>
          <button
            onClick={() => setTab("tag")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === "tag" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-500"
            }`}
          >
            태그 ({tags.length})
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* 게이트웨이 secret 1회 표시 모달 */}
        {gwResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="rounded-2xl bg-slate-900 border border-amber-500/40 p-5 max-w-md w-full">
              <div className="text-amber-300 font-bold text-base mb-2">⚠ Gateway Secret 발급 (1회 표시)</div>
              <div className="text-xs text-slate-400 mb-3">
                <span className="text-cyan-300">{gwResult.gatewayId}</span> 게이트웨이의 secret 입니다.
                펌웨어 설정에 입력하고 안전하게 보관하세요.
                <span className="text-red-300"> 이 창을 닫으면 다시 볼 수 없습니다.</span>
              </div>
              <div className="rounded-lg bg-black/50 border border-white/10 p-3 font-mono text-sm text-emerald-300 break-all mb-3">
                {gwResult.secret}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(gwResult.secret).catch(() => {})
                }}
                className="w-full py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold mb-2"
              >
                클립보드 복사
              </button>
              <button
                onClick={() => setGwResult(null)}
                className="w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-sm"
              >
                닫기 (다시 못 봄)
              </button>
            </div>
          </div>
        )}

        {loading && <div className="py-12 text-center text-slate-500">불러오는 중...</div>}

        {!loading && tab === "gateway" && (
          <div className="px-4 py-4 space-y-3">
            {/* 게이트웨이 등록 버튼 */}
            <button
              onClick={() => setGwOpen((v) => !v)}
              className="w-full py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold"
            >
              {gwOpen ? "닫기" : "+ 게이트웨이 등록"}
            </button>

            {gwOpen && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2">
                <div className="text-xs text-slate-400 mb-1">게이트웨이 ID (펌웨어 표기)</div>
                <input
                  type="text"
                  value={gwId}
                  onChange={(e) => setGwId(e.target.value)}
                  placeholder="예: GW-MARVEL-101"
                  maxLength={64}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                />
                <div className="text-xs text-slate-400 mb-1 mt-2">표시 이름 (선택)</div>
                <input
                  type="text"
                  value={gwName}
                  onChange={(e) => setGwName(e.target.value)}
                  placeholder="예: 1번방 입구"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                />
                <div className="text-xs text-slate-400 mb-1 mt-2">설치 위치</div>
                <select
                  value={gwType}
                  onChange={(e) => setGwType(e.target.value as "room" | "common" | "entrance")}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="room">방 안 (room)</option>
                  <option value="common">공용 공간 (common)</option>
                  <option value="entrance">출입구 (entrance)</option>
                </select>
                {gwType === "room" && (
                  <>
                    <div className="text-xs text-slate-400 mb-1 mt-2">방 매핑</div>
                    <select
                      value={gwRoomUuid}
                      onChange={(e) => setGwRoomUuid(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">선택 안 함 (나중에)</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.room_no}번방{r.room_name ? ` (${r.room_name})` : ""}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  onClick={handleGwSubmit}
                  disabled={!gwId || gwSubmitting}
                  className="w-full mt-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-semibold disabled:opacity-40"
                >
                  {gwSubmitting ? "등록 중..." : "등록 + Secret 발급"}
                </button>
              </div>
            )}

            {/* 게이트웨이 목록 */}
            <div className="space-y-2">
              {gateways.length === 0 && !loading && (
                <div className="py-8 text-center text-slate-500 text-sm">
                  등록된 게이트웨이 없음. 위에서 + 게이트웨이 등록.
                </div>
              )}
              {gateways.map((g) => (
                <div key={g.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${g.is_online ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <span className="font-semibold text-cyan-200 truncate">{g.gateway_id}</span>
                      {g.display_name && (
                        <span className="text-xs text-slate-400 truncate">— {g.display_name}</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      g.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-500"
                    }`}>
                      {g.is_active ? "활성" : "비활성"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-400 mb-2">
                    <div>설치: {g.gateway_type === "room" ? "방 안" : g.gateway_type === "entrance" ? "출입구" : "공용"}</div>
                    <div>방: {g.room_label ?? "—"}</div>
                    <div>마지막 통신: {lastSeenLabel(g.last_seen_at)}</div>
                    <div className="font-mono">secret: {g.secret_preview}</div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => handleGwToggleActive(g)}
                      className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-[11px] text-slate-300"
                    >
                      {g.is_active ? "비활성화" : "활성화"}
                    </button>
                    <button
                      onClick={() => handleGwRegenerate(g)}
                      className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300"
                    >
                      Secret 재발급
                    </button>
                    <button
                      onClick={() => handleGwDelete(g.id, g.gateway_id)}
                      className="ml-auto px-2 py-1 rounded bg-red-500/15 border border-red-500/30 text-[11px] text-red-300"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && tab === "tag" && (
          <div className="px-4 py-4 space-y-3">
            {/* 🆕 자동 감지 — 게이트웨이가 본 미등록 태그 */}
            {discovered.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-amber-300 font-semibold text-sm">
                    🆕 자동 감지된 새 태그 ({discovered.length}개)
                  </div>
                  <span className="text-[10px] text-amber-400/60">5초마다 갱신</span>
                </div>
                <div className="text-[11px] text-amber-200/70 mb-1">
                  태그를 게이트웨이 가까이 가져오면 여기 나타납니다. 신호 강한 순.
                </div>
                <div className="space-y-1.5">
                  {discovered.map((d) => (
                    <div key={d.minor} className="rounded-lg bg-black/20 border border-amber-500/20 p-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-amber-200">#{d.minor}</span>
                          {d.avg_rssi !== null && (
                            <span className={`text-[10px] px-2 py-0.5 rounded ${
                              d.avg_rssi > -60 ? "bg-emerald-500/20 text-emerald-300" :
                              d.avg_rssi > -80 ? "bg-cyan-500/20 text-cyan-300" :
                              "bg-slate-500/20 text-slate-400"
                            }`}>
                              📶 {d.avg_rssi}dBm {d.avg_rssi > -60 ? "(매우 가까움)" : d.avg_rssi > -80 ? "(가까움)" : "(멀음)"}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {d.detect_count}회 감지
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mb-2">
                        감지 위치: {d.last_room_label ?? d.last_gateway_label ?? d.last_gateway_id}
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const m = e.target.value
                            if (m !== undefined) {
                              void handleQuickRegister(d, m)
                              e.target.value = ""
                            }
                          }}
                          className="flex-1 bg-white/[0.04] border border-amber-500/30 rounded px-2 py-1.5 text-xs"
                        >
                          <option value="" disabled>+ 등록 (직원 선택)</option>
                          <option value="">직원 미지정으로 등록</option>
                          {staff.map((s) => (
                            <option key={s.membership_id} value={s.membership_id}>
                              {s.name} ({s.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setTagOpen((v) => !v)}
              className="w-full py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold"
            >
              {tagOpen ? "닫기" : "+ 태그 등록 (수동 minor 입력)"}
            </button>

            {tagOpen && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2">
                <div className="text-xs text-slate-400 mb-1">Minor 번호 (1-65535)</div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={tagMinor}
                  onChange={(e) => setTagMinor(e.target.value)}
                  placeholder="예: 101"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                />
                <div className="text-xs text-slate-400 mb-1 mt-2">라벨 (선택)</div>
                <input
                  type="text"
                  value={tagLabel}
                  onChange={(e) => setTagLabel(e.target.value)}
                  placeholder="예: 미미 사물함, 검정 끈"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                />
                <div className="text-xs text-slate-400 mb-1 mt-2">착용 직원 (선택)</div>
                <select
                  value={tagMember}
                  onChange={(e) => setTagMember(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">선택 안 함 (나중에)</option>
                  {staff.map((s) => (
                    <option key={s.membership_id} value={s.membership_id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleTagSubmit}
                  disabled={!tagMinor || tagSubmitting}
                  className="w-full mt-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-semibold disabled:opacity-40"
                >
                  {tagSubmitting ? "등록 중..." : "등록"}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {tags.length === 0 && (
                <div className="py-8 text-center text-slate-500 text-sm">
                  등록된 태그 없음.
                </div>
              )}
              {tags.map((t) => (
                <div key={t.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.is_online ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <span className="font-mono font-semibold text-cyan-200">#{t.minor}</span>
                      {t.tag_label && <span className="text-xs text-slate-400 truncate">— {t.tag_label}</span>}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      t.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-500"
                    }`}>
                      {t.is_active ? "활성" : "비활성"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-400 mb-2">
                    <div>마지막 감지: {lastSeenLabel(t.last_seen_at)}</div>
                    <div>이벤트: {t.last_event_type ?? "—"}</div>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    착용: {t.member_name ? `${t.member_name} (${t.member_role})` : "(미지정)"}
                  </div>
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <select
                      value={t.membership_id ?? ""}
                      onChange={(e) => handleTagAssignMember(t, e.target.value)}
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px]"
                    >
                      <option value="">미지정</option>
                      {staff.map((s) => (
                        <option key={s.membership_id} value={s.membership_id}>
                          {s.name} ({s.role})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleTagToggleActive(t)}
                      className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-[11px] text-slate-300"
                    >
                      {t.is_active ? "비활성" : "활성"}
                    </button>
                    <button
                      onClick={() => handleTagDelete(t)}
                      className="px-2 py-1 rounded bg-red-500/15 border border-red-500/30 text-[11px] text-red-300"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 펌웨어 설정 가이드 */}
        {!loading && tab === "gateway" && gateways.length === 0 && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-2">
            <div className="font-semibold">📡 게이트웨이 펌웨어 설정 안내</div>
            <p>
              게이트웨이 등록 후 발급되는 secret 을 펌웨어에 입력하세요. 게이트웨이는 다음 endpoint 로 데이터를 전송:
            </p>
            <div className="font-mono bg-black/40 rounded p-2 break-all">
              POST https://nox.ai.kr/api/ble/ingest<br />
              Header: X-Gateway-Id, X-Gateway-Secret
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
