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

/**
 * ChatListPage — composition container.
 * All state/fetch/mutation lives in useChatRooms.
 * Only renders layout + wires hook return → components.
 */

export default function ChatListPage() {
  const router = useRouter()
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

  // STEP-009.5: total unread is server-computed (sum of caller's
  // chat_participants.unread_count scoped by membership_id + store_uuid).
  // Badge refreshes on mount, on tab refocus (visibilitychange), and when
  // the rooms list itself is refreshed (coalesced below).
  const { totalUnread } = useChatUnread()

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
            Back button target is a fixed, always-valid destination.
            History: STEP-009-nav-loop replaced router.back() with router.push("/")
            to escape a /chat↔/chat/[id] loop. "/" then 404'd because the app
            has no root landing page, so the target is pinned to /counter —
            every authenticated chat user reaches /chat from /counter, so
            /counter is the canonical "back" for the chat surface.
          */}
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
          <div className="flex items-center gap-2">
            <span className="font-semibold">채팅</span>
            <ChatUnreadBadge count={totalUnread} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => group.openCreate()}
              className="text-cyan-400 text-sm"
            >
              + 그룹
            </button>
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
