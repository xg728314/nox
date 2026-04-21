"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import type { StaffMember } from "./useChatRooms"

/**
 * useGroupChat — group chat create + membership management flow.
 *
 * Design (STEP-009.2):
 *   - Independent from useChatRooms (list owner) and useChatMessages (detail
 *     owner). This hook is specific to the group-admin surface and can be
 *     mounted from either the list page (create) or a future room settings
 *     panel (add/remove).
 *   - No JSX. UI lives in GroupCreateModal / GroupMembersPanel / MemberPicker.
 *   - Component files must not fetch directly — every API call flows through
 *     this hook.
 *
 * Responsibilities:
 *   - create modal state + chosen name + chosen member ids
 *   - create API call to POST /api/chat/rooms { type: "group", name, member_ids }
 *   - members panel state (list + loading + error)
 *   - add API call to POST /api/chat/rooms/[id]/participants
 *   - remove API call to DELETE /api/chat/rooms/[id]/participants?membership_id=...
 *   - staff lookup helper (for the member picker) — reuses /api/store/staff
 */

export type GroupMember = {
  id: string
  membership_id: string
  name: string | null
  role: string | null
  joined_at: string
}

export type CreateFormState = {
  name: string
  selectedMemberIds: Set<string>
}

const EMPTY_FORM: CreateFormState = {
  name: "",
  selectedMemberIds: new Set<string>(),
}

type UseGroupChatReturn = {
  // create modal
  createOpen: boolean
  openCreate: () => void
  closeCreate: () => void
  form: CreateFormState
  setName: (v: string) => void
  toggleMember: (membershipId: string) => void
  clearMembers: () => void
  staff: StaffMember[]
  staffLoading: boolean
  creating: boolean
  submitCreate: () => Promise<void>

  // members panel
  panelOpen: boolean
  panelRoomId: string | null
  openPanel: (roomId: string) => Promise<void>
  closePanel: () => void
  members: GroupMember[]
  membersLoading: boolean
  addMembers: (ids: string[]) => Promise<void>
  removeMember: (membershipId: string) => Promise<void>

  // group close (STEP-009.4) — creator/owner only, enforced server-side
  closing: boolean
  closeGroup: () => Promise<boolean>

  // shared error
  error: string
  setError: (v: string) => void
}

export function useGroupChat(): UseGroupChatReturn {
  const router = useRouter()

  const [error, setError] = useState("")

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ name: "", selectedMemberIds: new Set() })
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  // Members panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelRoomId, setPanelRoomId] = useState<string | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const fetchStaff = useCallback(async () => {
    setStaffLoading(true)
    try {
      const res = await apiFetch("/api/store/staff")
      if (res.ok) {
        const d = await res.json()
        setStaff((d.staff ?? []) as StaffMember[])
      }
    } catch { /* ignore */ }
    finally { setStaffLoading(false) }
  }, [])

  const openCreate = useCallback(() => {
    setError("")
    setForm({ ...EMPTY_FORM, selectedMemberIds: new Set() })
    setCreateOpen(true)
    fetchStaff()
  }, [fetchStaff])

  const closeCreate = useCallback(() => {
    setCreateOpen(false)
  }, [])

  const setName = useCallback((v: string) => {
    setForm(prev => ({ ...prev, name: v }))
  }, [])

  const toggleMember = useCallback((membershipId: string) => {
    setForm(prev => {
      const next = new Set(prev.selectedMemberIds)
      if (next.has(membershipId)) next.delete(membershipId)
      else next.add(membershipId)
      return { ...prev, selectedMemberIds: next }
    })
  }, [])

  const clearMembers = useCallback(() => {
    setForm(prev => ({ ...prev, selectedMemberIds: new Set() }))
  }, [])

  const submitCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    setError("")
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        body: JSON.stringify({
          type: "group",
          name: form.name.trim() || undefined,
          member_ids: Array.from(form.selectedMemberIds),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || "그룹 채팅 생성 실패")
        return
      }
      setCreateOpen(false)
      setForm({ ...EMPTY_FORM, selectedMemberIds: new Set() })
      if (data.chat_room_id) router.push(`/chat/${data.chat_room_id}`)
    } catch {
      setError("서버 오류")
    } finally {
      setCreating(false)
    }
  }, [creating, form, router])

  // ── Members panel ───────────────────────────────────────────
  const fetchMembers = useCallback(async (roomId: string) => {
    setMembersLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/chat/rooms/${roomId}/participants`)
      if (res.ok) {
        const d = await res.json()
        setMembers((d.participants ?? []) as GroupMember[])
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "멤버 목록을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setMembersLoading(false)
    }
  }, [])

  const openPanel = useCallback(async (roomId: string) => {
    setPanelRoomId(roomId)
    setPanelOpen(true)
    if (staff.length === 0) fetchStaff()
    await fetchMembers(roomId)
  }, [fetchMembers, fetchStaff, staff.length])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setPanelRoomId(null)
  }, [])

  const addMembers = useCallback(async (ids: string[]) => {
    if (!panelRoomId || ids.length === 0) return
    setError("")
    try {
      const res = await apiFetch(`/api/chat/rooms/${panelRoomId}/participants`, {
        method: "POST",
        body: JSON.stringify({ member_ids: ids }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "멤버 추가 실패")
        return
      }
      await fetchMembers(panelRoomId)
    } catch {
      setError("서버 오류")
    }
  }, [panelRoomId, fetchMembers])

  const removeMember = useCallback(async (membershipId: string) => {
    if (!panelRoomId) return
    setError("")
    try {
      const res = await apiFetch(
        `/api/chat/rooms/${panelRoomId}/participants?membership_id=${membershipId}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "멤버 제거 실패")
        return
      }
      await fetchMembers(panelRoomId)
    } catch {
      setError("서버 오류")
    }
  }, [panelRoomId, fetchMembers])

  // STEP-009.4: group close — creator/owner only, server-enforced.
  // Returns true on success so callers can close the members panel +
  // refresh the rooms list without the hook owning that navigation.
  const [closing, setClosing] = useState(false)
  const closeGroup = useCallback(async (): Promise<boolean> => {
    if (!panelRoomId || closing) return false
    setClosing(true)
    setError("")
    try {
      const res = await apiFetch(`/api/chat/rooms/${panelRoomId}/close`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "그룹 닫기 실패")
        return false
      }
      setPanelOpen(false)
      setPanelRoomId(null)
      return true
    } catch {
      setError("서버 오류")
      return false
    } finally {
      setClosing(false)
    }
  }, [panelRoomId, closing])

  return {
    createOpen,
    openCreate,
    closeCreate,
    form,
    setName,
    toggleMember,
    clearMembers,
    staff,
    staffLoading,
    creating,
    submitCreate,
    panelOpen,
    panelRoomId,
    openPanel,
    closePanel,
    members,
    membersLoading,
    addMembers,
    removeMember,
    closing,
    closeGroup,
    error,
    setError,
  }
}
