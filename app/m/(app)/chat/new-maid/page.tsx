"use client"
/**
 * 메이드톡 채팅 만들기 페이지 · /m/chat/new-maid
 *
 * 목적: 매장 여러 곳 골라서 메이드톡 전용 그룹 채팅 개설.
 *   - 파싱 자동 인식 활성 (pattern_enabled=true)
 *   - 선택한 매장 각각의 owner/manager 를 참여자로 자동 추가
 *   - 내 매장 + 친한 매장 몇 개만 묶기 가능
 *
 * 흐름:
 *   1. 매장 15개 리스트 · 내 매장은 자동 체크 (해제 불가)
 *   2. 이름 (선택) · 미입력 시 "메이드톡" 기본
 *   3. 만들기 → 각 매장 owner/manager 조회 → member_ids 배열로 POST
 *   4. 성공 → /m/chat/[id] 로 이동
 *
 * R-maid-chat (2026-08-23)
 */
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"
import { useMe, useBuildingStores } from "../../../_hooks/useMobileData"
import { cn } from "../../../_lib/cn"

export default function NewMaidChatPage() {
  const router = useRouter()
  const toast = useToast()
  const me = useMe()
  const buildingS = useBuildingStores()
  const myStoreUuid = me.data?.store_uuid ?? null

  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set())
  const [roomName, setRoomName] = useState("")
  const [busy, setBusy] = useState(false)

  // 내 매장은 자동 선택 (해제 불가)
  useEffect(() => {
    if (myStoreUuid) {
      setSelectedStores((s) => {
        const n = new Set(s)
        n.add(myStoreUuid)
        return n
      })
    }
  }, [myStoreUuid])

  const stores = buildingS.data?.stores ?? []
  const myStore = stores.find((s) => s.store_uuid === myStoreUuid)

  const toggleStore = (uuid: string) => {
    if (uuid === myStoreUuid) return  // 내 매장은 해제 불가
    setSelectedStores((s) => {
      const n = new Set(s)
      if (n.has(uuid)) n.delete(uuid); else n.add(uuid)
      return n
    })
  }

  const previewName = useMemo(() => {
    if (roomName.trim()) return roomName.trim()
    const selected = stores.filter((s) => selectedStores.has(s.store_uuid))
    if (selected.length === 1) return `${selected[0].store_name} 메이드톡`
    if (selected.length <= 3) return `${selected.map((s) => s.store_name).join("·")} 메이드톡`
    return `메이드톡 · ${selected.length}매장`
  }, [roomName, stores, selectedStores])

  const create = async () => {
    if (selectedStores.size === 0) return toast("매장을 선택하세요", "error")
    setBusy(true)
    try {
      // 각 매장의 owner/manager 조회 → member_ids
      const memberIds: string[] = []
      for (const storeUuid of Array.from(selectedStores)) {
        if (storeUuid === myStoreUuid) continue  // 본인은 서버가 자동 포함
        const r = await apiFetch(`/api/store/staff?store_uuid=${storeUuid}`)
        const j = await r.json().catch(() => ({}))
        const staff = (j.staff || []).filter((s: { role: string }) => s.role === "owner" || s.role === "manager")
        for (const s of staff) {
          if (s.membership_id) memberIds.push(s.membership_id)
        }
      }

      const createRes = await apiFetch("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "group",
          name: previewName,
          member_ids: memberIds,
          pattern_enabled: true,  // 메이드톡 자동 파싱
        }),
      })
      const cj = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        return toast(`생성 실패: ${cj.message || cj.error || createRes.status}`, "error")
      }
      const chatRoomId = cj.chat_room_id
      toast(`✓ 메이드톡 개설 · ${cj.member_count ?? memberIds.length + 1}명 초대`, "success")
      router.push(`/m/chat/${chatRoomId}`)
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="🎯 메이드톡 만들기"
        subtitle="매장 골라서 · 파싱 자동 인식"
        backHref="/m/chat"
      />

      <div className="px-5 py-4 pb-32 space-y-4">
        {/* 이름 */}
        <section>
          <label className="text-[11px] font-extrabold text-[#A87D45] mb-1 block">채팅방 이름 (선택)</label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder={`자동: ${previewName}`}
            maxLength={40}
            className="w-full rounded-xl border border-[#D8D2C8] px-3 py-2.5 text-[13px] font-extrabold text-[#2D2B26] bg-white"
          />
        </section>

        {/* 매장 선택 */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-extrabold text-[#A87D45]">참여 매장 · {selectedStores.size}곳</label>
            <span className="text-[10px] text-[#7A746A] font-bold">내 매장 필수</span>
          </div>
          {buildingS.isLoading && <div className="text-[11px] text-[#7A746A] py-4 text-center">매장 로딩...</div>}
          <div className="grid grid-cols-3 gap-1.5">
            {stores.map((s) => {
              const isMine = s.store_uuid === myStoreUuid
              const checked = selectedStores.has(s.store_uuid)
              return (
                <button
                  key={s.store_uuid}
                  type="button"
                  onClick={() => toggleStore(s.store_uuid)}
                  disabled={isMine}
                  className={cn(
                    "rounded-xl py-2 px-2 text-left border-2 transition",
                    checked
                      ? "bg-[#C49B61]/20 border-[#C49B61] text-[#8C6A3A]"
                      : "bg-white border-[#D8D2C8] text-[#7A746A]",
                    isMine && "opacity-90",
                  )}
                >
                  <div className="text-[11px] font-extrabold flex items-center gap-1">
                    {checked && <span>✓</span>}
                    {s.store_name}
                    {isMine && <span className="text-[8px] font-black text-[#A87D45]">내</span>}
                  </div>
                  <div className="text-[9px] font-bold opacity-70">{s.floor}층</div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 안내 */}
        <div className="rounded-xl bg-[#FBF6EC] border border-[#EDE7DA] p-3">
          <div className="text-[11px] font-extrabold text-[#8C6A3A] mb-1">📖 메이드톡 특징</div>
          <ul className="text-[10px] font-bold text-[#7A746A] list-disc pl-4 space-y-0.5">
            <li>&quot;1번방 지수 셔 완메&quot; 형식 자동 파싱 · 세션 등록</li>
            <li>미등록 아가씨 자동 생성 · 자동 출근 체크</li>
            <li>각 매장 사장/실장 자동 초대</li>
            <li>일반 대화도 가능 · 파싱 안 되면 그냥 메시지</li>
          </ul>
        </div>

        {/* 생성 버튼 */}
        <button
          type="button"
          onClick={create}
          disabled={busy || selectedStores.size === 0}
          className={cn(
            "w-full rounded-2xl py-3.5 text-[14px] font-extrabold shadow-md transition",
            busy || selectedStores.size === 0
              ? "bg-[#B0A99B] text-white opacity-60"
              : "bg-gradient-to-r from-[#5FAB4E] to-[#3E7A32] text-white",
          )}
        >
          {busy ? "만드는 중..." : `🎯 메이드톡 만들기 (${selectedStores.size}개 매장)`}
        </button>
      </div>

      <TabBar />
    </div>
  )
}
