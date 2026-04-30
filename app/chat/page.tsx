"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useChatRooms } from "./hooks/useChatRooms"
import { useGroupChat } from "./hooks/useGroupChat"
import { useChatUnread } from "./hooks/useChatUnread"
import ChatRoomList from "./components/ChatRoomList"
import NewDmModal from "./components/NewDmModal"
import GroupCreateModal from "./components/GroupCreateModal"
import ChatUnreadBadge from "./components/ChatUnreadBadge"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

/**
 * ChatListPage — composition container.
 * All state/fetch/mutation lives in useChatRooms.
 * Only renders layout + wires hook return → components.
 */

export default function ChatListPage() {
  const router = useRouter()
  // 2026-05-01 R-Hostess-Home: 스태프(staff/hostess) 시점에서는 그룹 생성 X.
  //   서버 (POST /api/chat/rooms type=global / group) 가 ROLE_FORBIDDEN 으로
  //   차단하지만 UI 도 진입점 자체 숨겨서 일관된 UX 제공.
  const profile = useCurrentProfile()
  const isStaffRole =
    profile?.role === "hostess" || profile?.role === "staff"
  const {
    rooms, loading, error, setError,
    needsLogin,
    showNewDm, openNewDm, closeNewDm,
    staff, creating, createDm,
    togglePin, leaveRoom,
  } = useChatRooms()

  async function handleLeave(roomId: string, type: string, isCreator: boolean) {
    // Creator of a group → leaving auto-closes the room for everyone.
    // Non-creator or direct → caller-only soft-leave.
    let message: string
    if (type === "group" && isCreator) {
      message = "이 그룹을 종료하시겠습니까?\n(모든 참여자에게 채팅이 종료되며 되돌릴 수 없습니다.)"
    } else if (type === "group") {
      message = "그룹 채팅에서 나가시겠습니까?\n(나 혼자 나가며, 다른 참여자에게는 영향이 없습니다.)"
    } else {
      message = "1:1 채팅에서 나가시겠습니까?\n(나 혼자 나가며, 상대방에게는 영향이 없습니다.)"
    }
    if (typeof window !== "undefined" && !window.confirm(message)) {
      return
    }
    await leaveRoom(roomId)
  }

  // Navigation rule (nav-loop fix): the hook surfaces `needsLogin` instead
  // of navigating internally. The page is the only place that actually
  // performs router.push for auth gates, list-item opens, and the header
  // back button.
  useEffect(() => {
    if (needsLogin) router.push("/login")
  }, [needsLogin, router])

  const group = useGroupChat()

  // STEP-009.5 + 2026-05-01 R-Perf-Chat:
  //   total unread 는 rooms 응답에서 derive (별도 polling 제거).
  //   useChatRooms 가 rooms 갱신할 때마다 setUnreadFromRooms 로 sum 전달.
  //   network round trip 50% 감소.
  const { totalUnread, setUnreadFromRooms } = useChatUnread()
  useEffect(() => {
    setUnreadFromRooms(rooms)
  }, [rooms, setUnreadFromRooms])

  async function handlePickStaff(targetMembershipId: string) {
    const newRoomId = await createDm(targetMembershipId)
    if (newRoomId) router.push(`/chat/${newRoomId}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          {/*
            2026-04-26: 메뉴 루트 페이지 — 뒤로 = /counter 로 직행 (history 의존 X).
            서브 페이지 (/chat/[id]) 의 뒤로는 router.back() 으로 /chat 으로 와서,
            /chat 의 이 버튼이 다시 /counter 로 보냄. 두 번 누르면 카운터.
          */}
          <button
            onClick={() => router.push("/counter")}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <div className="flex items-center gap-2">
            <span className="font-semibold">채팅</span>
            <ChatUnreadBadge count={totalUnread} />
          </div>
          <div className="flex items-center gap-3">
            {/* 2026-05-01: 스태프는 그룹 생성 X (서버 가드 + UI 진입점 숨김). */}
            {!isStaffRole && (
              <button
                onClick={() => group.openCreate()}
                className="text-cyan-400 text-sm"
              >
                + 그룹
              </button>
            )}
            <button
              onClick={() => { showNewDm ? closeNewDm() : openNewDm() }}
              className="text-cyan-400 text-sm"
            >
              + DM
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">닫기</button>
          </div>
        )}

        <NewDmModal
          open={showNewDm}
          staff={staff}
          creating={creating}
          onPick={handlePickStaff}
        />

        <GroupCreateModal
          open={group.createOpen}
          form={group.form}
          staff={group.staff}
          staffLoading={group.staffLoading}
          creating={group.creating}
          error={group.error}
          onClose={group.closeCreate}
          onNameChange={group.setName}
          onToggleMember={group.toggleMember}
          onSubmit={group.submitCreate}
        />

        <div className="px-4 py-4">
          <ChatRoomList
            rooms={rooms}
            error={error}
            onOpen={(roomId) => router.push(`/chat/${roomId}`)}
            onTogglePin={togglePin}
            onLeave={handleLeave}
          />
        </div>
      </div>
    </div>
  )
}
